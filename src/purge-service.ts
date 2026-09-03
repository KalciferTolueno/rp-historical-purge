import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { calculateCutoff } from './config.js';
import { logger } from './logger.js';
import {
  isStoragePathProtected,
  referencedStorageFingerprint,
} from './purge-safety.js';
import { isUuid, STORAGE_BUCKET, STORAGE_PREFIX, storagePathFromUrl } from './storage-path.js';
import type { ProtectionSnapshot, PurgeConfig, PurgeSummary } from './types.js';

const PROCEDURE_READ_BATCH = 1000;
const LINKED_EVENT_READ_BATCH = 64;
const STORAGE_READ_BATCH = 1000;
const STORAGE_DELETE_BATCH = 100;
const CRA_READ_BATCH = 500;
const CRA_REFERENCE_READ_BATCH = 1000;
const CRA_DELETE_BATCH = 64;

type StorageObject = { id: string; name: string };
type CraEvent = { id: string; imageUrl: string | null };

interface CraPurgeResult {
  scanned: number;
  deleted: number;
  protected: number;
  complete: boolean;
  plannedDeleteIds: Set<string>;
}

interface StoragePurgeResult {
  scanned: number;
  deleted: number;
  protected: number;
  referenced: number;
  complete: boolean;
}

function sleep(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function mergeProtection(target: ProtectionSnapshot, source: ProtectionSnapshot): void {
  source.protectedPaths.forEach((path) => target.protectedPaths.add(path));
  source.linkedEventIds.forEach((id) => target.linkedEventIds.add(id));
  target.procedureCount = Math.max(target.procedureCount, source.procedureCount);
}

export function createSupabaseClient(config: PurgeConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { 'X-Client-Info': 'rp-historical-purge/1.4.0' } },
  });
}

export async function fetchProtection(client: SupabaseClient): Promise<ProtectionSnapshot> {
  const snapshot: ProtectionSnapshot = {
    procedureCount: 0,
    protectedPaths: new Set<string>(),
    linkedEventIds: new Set<string>(),
  };
  let from = 0;

  while (true) {
    const { data, error } = await client
      .from('procedures')
      .select('id,event_id,image_url')
      .order('id', { ascending: true })
      .range(from, from + PROCEDURE_READ_BATCH - 1);

    if (error) throw new Error(`No se pudo proteger Procedimientos: ${error.message}`);
    if (!data?.length) break;

    snapshot.procedureCount += data.length;
    for (const row of data) {
      const path = storagePathFromUrl(row.image_url as string | null);
      if (path) snapshot.protectedPaths.add(path);
      const eventId = row.event_id as string | null;
      if (isUuid(eventId)) snapshot.linkedEventIds.add(eventId);
    }

    if (data.length < PROCEDURE_READ_BATCH) break;
    from += PROCEDURE_READ_BATCH;
  }

  const linkedIds = [...snapshot.linkedEventIds];
  for (let index = 0; index < linkedIds.length; index += LINKED_EVENT_READ_BATCH) {
    const ids = linkedIds.slice(index, index + LINKED_EVENT_READ_BATCH);
    const { data, error } = await client.from('cra_events').select('id,image_url').in('id', ids);
    if (error) throw new Error(`No se pudo proteger eventos vinculados: ${error.message}`);
    for (const row of data ?? []) {
      const path = storagePathFromUrl(row.image_url as string | null);
      if (path) snapshot.protectedPaths.add(path);
    }
  }

  return snapshot;
}

async function fetchCraPage(
  client: SupabaseClient,
  cutoffIso: string,
  cursorId: string | null,
): Promise<CraEvent[]> {
  let query = client
    .from('cra_events')
    .select('id,image_url')
    .lt('created_at', cutoffIso)
    .order('id', { ascending: true })
    .limit(CRA_READ_BATCH);

  if (cursorId) query = query.gt('id', cursorId);
  const { data, error } = await query;
  if (error) throw new Error(`No se pudieron leer eventos CRA: ${error.message}`);
  return (data ?? [])
    .map((row) => ({ id: row.id as string, imageUrl: (row.image_url as string | null) ?? null }))
    .filter((row) => isUuid(row.id));
}

async function deleteCraEvents(
  client: SupabaseClient,
  events: CraEvent[],
  delayMs: number,
): Promise<CraEvent[]> {
  const deleted: CraEvent[] = [];
  for (let index = 0; index < events.length; index += CRA_DELETE_BATCH) {
    const chunk = events.slice(index, index + CRA_DELETE_BATCH);
    const { data, error } = await client
      .from('cra_events')
      .delete()
      .in(
        'id',
        chunk.map((event) => event.id),
      )
      .select('id,image_url');
    if (error) throw new Error(`No se pudo borrar un lote CRA: ${error.message}`);
    deleted.push(
      ...(data ?? []).map((row) => ({
        id: row.id as string,
        imageUrl: (row.image_url as string | null) ?? null,
      })),
    );
    await sleep(delayMs);
  }
  return deleted;
}

async function hasRemainingDeletableCra(
  client: SupabaseClient,
  cutoffIso: string,
  protection: ProtectionSnapshot,
  plannedDeleteIds: ReadonlySet<string>,
): Promise<boolean> {
  let cursorId: string | null = null;
  while (true) {
    const events = await fetchCraPage(client, cutoffIso, cursorId);
    if (events.length === 0) return false;
    if (
      events.some(
        (event) =>
          !protection.linkedEventIds.has(event.id) && !plannedDeleteIds.has(event.id),
      )
    ) {
      return true;
    }
    if (events.length < CRA_READ_BATCH) return false;
    cursorId = events.at(-1)?.id ?? null;
  }
}

async function purgeCra(
  client: SupabaseClient,
  config: PurgeConfig,
  cutoffIso: string,
  protection: ProtectionSnapshot,
): Promise<CraPurgeResult> {
  let cursorId: string | null = null;
  let scanned = 0;
  let deleted = 0;
  let protectedCount = 0;
  const plannedDeleteIds = new Set<string>();

  while (deleted < config.maxCraDeletesPerRun) {
    const events = await fetchCraPage(client, cutoffIso, cursorId);
    if (events.length === 0) break;

    // Revalidar antes de cada página reduce la ventana en que un evento podría
    // quedar vinculado a un Procedimiento mientras la purga está trabajando.
    mergeProtection(protection, await fetchProtection(client));
    const remainingBudget = config.maxCraDeletesPerRun - deleted;
    const deletable: CraEvent[] = [];

    for (const event of events) {
      scanned += 1;
      if (protection.linkedEventIds.has(event.id)) protectedCount += 1;
      else if (deletable.length < remainingBudget) deletable.push(event);
    }

    if (config.mode === 'execute') {
      const actuallyDeleted = await deleteCraEvents(client, deletable, config.batchDelayMs);
      for (const event of actuallyDeleted) plannedDeleteIds.add(event.id);
      deleted += actuallyDeleted.length;
    } else {
      for (const event of deletable) plannedDeleteIds.add(event.id);
      deleted += deletable.length;
    }

    cursorId = events.at(-1)?.id ?? null;
    logger.info('Página CRA revisada', {
      scanned,
      [config.mode === 'execute' ? 'deleted' : 'wouldDelete']: deleted,
      protected: protectedCount,
    });

    if (events.length < CRA_READ_BATCH) break;
  }

  mergeProtection(protection, await fetchProtection(client));
  const complete = !(await hasRemainingDeletableCra(
    client,
    cutoffIso,
    protection,
    config.mode === 'dry-run' ? plannedDeleteIds : new Set<string>(),
  ));

  return { scanned, deleted, protected: protectedCount, complete, plannedDeleteIds };
}

async function collectRemainingCraReferences(
  client: SupabaseClient,
  excludedIds: ReadonlySet<string>,
  delayMs: number,
  createdAtGte: string | null = null,
): Promise<{ rowsScanned: number; fingerprints: Set<string> }> {
  let cursorId: string | null = null;
  let rowsScanned = 0;
  let pagesScanned = 0;
  const fingerprints = new Set<string>();

  while (true) {
    let query = client
      .from('cra_events')
      .select('id,image_url')
      .not('image_url', 'is', null)
      .order('id', { ascending: true })
      .limit(CRA_REFERENCE_READ_BATCH);
    if (createdAtGte) query = query.gte('created_at', createdAtGte);
    if (cursorId) query = query.gt('id', cursorId);

    const { data, error } = await query;
    if (error) throw new Error(`No se pudieron comprobar referencias CRA: ${error.message}`);
    if (!data?.length) break;

    for (const row of data) {
      const id = row.id as string;
      if (excludedIds.has(id)) continue;
      rowsScanned += 1;
      const fingerprint = referencedStorageFingerprint(row.image_url as string | null);
      if (fingerprint) fingerprints.add(fingerprint);
    }

    pagesScanned += 1;
    if (pagesScanned % 25 === 0) {
      logger.info('Comprobación de referencias CRA en progreso', {
        scanned: rowsScanned,
        referenced: fingerprints.size,
      });
    }

    cursorId = (data.at(-1)?.id as string | undefined) ?? null;
    if (data.length < CRA_REFERENCE_READ_BATCH) break;
    await sleep(delayMs);
  }

  return { rowsScanned, fingerprints };
}

async function fetchStoragePage(
  client: SupabaseClient,
  cutoffIso: string,
  cursorId: string | null,
): Promise<StorageObject[]> {
  let query = client
    .schema('storage')
    .from('objects')
    .select('id,name')
    .eq('bucket_id', STORAGE_BUCKET)
    .like('name', `${STORAGE_PREFIX}%`)
    .lt('created_at', cutoffIso)
    .order('id', { ascending: true })
    .limit(STORAGE_READ_BATCH);

  if (cursorId) query = query.gt('id', cursorId);
  const { data, error } = await query;
  if (error) throw new Error(`No se pudo leer Storage: ${error.message}`);
  return (data ?? [])
    .map((row) => ({ id: row.id as string, name: row.name as string }))
    .filter((row) => Boolean(row.id && row.name));
}

async function removeStoragePaths(
  client: SupabaseClient,
  paths: string[],
  delayMs: number,
  protection: ProtectionSnapshot,
): Promise<{ removed: number; protected: number }> {
  let removed = 0;
  let protectedCount = 0;
  for (let index = 0; index < paths.length; index += STORAGE_DELETE_BATCH) {
    mergeProtection(protection, await fetchProtection(client));
    const chunk = paths.slice(index, index + STORAGE_DELETE_BATCH);
    const safeChunk = chunk.filter((path) => !protection.protectedPaths.has(path));
    protectedCount += chunk.length - safeChunk.length;
    if (safeChunk.length > 0) {
      const { error } = await client.storage.from(STORAGE_BUCKET).remove(safeChunk);
      if (error) throw new Error(`Storage API rechazó un lote: ${error.message}`);
      removed += safeChunk.length;
    }
    await sleep(delayMs);
  }
  return { removed, protected: protectedCount };
}

async function purgeStorage(
  client: SupabaseClient,
  config: PurgeConfig,
  cutoffIso: string,
  protection: ProtectionSnapshot,
  remainingReferences: Set<string>,
  referenceSnapshotStartedAt: string,
): Promise<StoragePurgeResult> {
  let cursorId: string | null = null;
  let scanned = 0;
  let deleted = 0;
  let protectedCount = 0;
  let referencedCount = 0;

  while (true) {
    const objects = await fetchStoragePage(client, cutoffIso, cursorId);
    if (objects.length === 0) {
      return {
        scanned,
        deleted,
        protected: protectedCount,
        referenced: referencedCount,
        complete: true,
      };
    }

    mergeProtection(protection, await fetchProtection(client));
    // Un evento recibido mientras se construía la fotografía puede tener un
    // UUID anterior al cursor ya recorrido. Esta lectura incremental lo suma
    // antes de cada lote y mantiene aislada la recepción en tiempo real.
    const recentReferences = await collectRemainingCraReferences(
      client,
      new Set<string>(),
      0,
      referenceSnapshotStartedAt,
    );
    recentReferences.fingerprints.forEach((fingerprint) =>
      remainingReferences.add(fingerprint),
    );
    const deletable: string[] = [];
    let limitReached = false;

    for (const object of objects) {
      scanned += 1;
      const reason = isStoragePathProtected(
        object.name,
        protection.protectedPaths,
        remainingReferences,
      );
      if (reason === 'procedure') protectedCount += 1;
      else if (reason === 'cra-reference') referencedCount += 1;
      else if (deleted + deletable.length < config.maxStorageDeletesPerRun) {
        deletable.push(object.name);
      } else {
        limitReached = true;
        break;
      }
    }

    if (config.mode === 'execute') {
      const result = await removeStoragePaths(
        client,
        deletable,
        config.batchDelayMs,
        protection,
      );
      deleted += result.removed;
      protectedCount += result.protected;
    } else {
      deleted += deletable.length;
    }

    cursorId = objects.at(-1)?.id ?? null;
    logger.info('Página de Storage revisada', {
      scanned,
      [config.mode === 'execute' ? 'deleted' : 'wouldDelete']: deleted,
      protected: protectedCount,
      referenced: referencedCount,
    });

    if (limitReached) {
      return {
        scanned,
        deleted,
        protected: protectedCount,
        referenced: referencedCount,
        complete: false,
      };
    }

    if (objects.length < STORAGE_READ_BATCH) {
      return {
        scanned,
        deleted,
        protected: protectedCount,
        referenced: referencedCount,
        complete: true,
      };
    }
  }
}

export async function runPurge(
  config: PurgeConfig,
  client: SupabaseClient = createSupabaseClient(config),
  now: Date = new Date(),
): Promise<PurgeSummary> {
  const startedAt = now.toISOString();
  const cutoff = calculateCutoff(now, config.retentionDays).toISOString();
  logger.info('Iniciando purga histórica', {
    mode: config.mode,
    cutoff,
    retentionDays: config.retentionDays,
  });

  // La protección se obtiene antes de cualquier escritura. Si falla, se aborta.
  const protection = await fetchProtection(client);

  // Seguridad ante interrupciones: primero desaparece la fila visible. Storage
  // sólo se toca cuando ya no quedan filas CRA antiguas fuera de protección.
  const cra = await purgeCra(client, config, cutoff, protection);
  let storage: StoragePurgeResult = {
    scanned: 0,
    deleted: 0,
    protected: 0,
    referenced: 0,
    complete: false,
  };
  let remainingCraReferences = 0;
  let storagePhaseSkipped = !cra.complete;
  let storageSkipReason: string | null = cra.complete ? null : 'cra-pending';

  if (cra.complete) {
    logger.info('Comprobando imágenes aún utilizadas antes de tocar Storage', {
      mode: config.mode,
    });
    const referenceSnapshotStartedAt = new Date().toISOString();
    const references = await collectRemainingCraReferences(
      client,
      config.mode === 'dry-run' ? cra.plannedDeleteIds : new Set<string>(),
      config.batchDelayMs,
    );
    logger.info('Comprobación de referencias CRA finalizada', {
      scanned: references.rowsScanned,
      referenced: references.fingerprints.size,
    });

    // Revalidación final: cualquier error ocurre antes del primer DELETE Storage.
    mergeProtection(protection, await fetchProtection(client));
    storage = await purgeStorage(
      client,
      config,
      cutoff,
      protection,
      references.fingerprints,
      referenceSnapshotStartedAt,
    );
    remainingCraReferences = references.fingerprints.size;
    storagePhaseSkipped = false;
    storageSkipReason = null;
  } else {
    logger.warn('CRA alcanzó el límite; Storage queda intacto hasta retirar las filas antiguas', {
      deleted: cra.deleted,
      mode: config.mode,
    });
  }

  const summary: PurgeSummary = {
    mode: config.mode,
    startedAt,
    finishedAt: new Date().toISOString(),
    cutoff,
    proceduresProtected: protection.procedureCount,
    pathsProtected: protection.protectedPaths.size,
    linkedEventsProtected: protection.linkedEventIds.size,
    storageScanned: storage.scanned,
    storageDeleted: storage.deleted,
    storageProtected: storage.protected,
    storageReferenced: storage.referenced,
    storagePhaseComplete: storage.complete,
    storagePhaseSkipped,
    storageSkipReason,
    craScanned: cra.scanned,
    craDeleted: cra.deleted,
    craProtected: cra.protected,
    craPhaseComplete: cra.complete,
    craPhaseSkipped: false,
    remainingCraReferences,
  };
  logger.info('Purga histórica finalizada', summary as unknown as Record<string, unknown>);
  return summary;
}
