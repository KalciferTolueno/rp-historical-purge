import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { calculateCutoff } from './config.js';
import { logger } from './logger.js';
import { isUuid, STORAGE_BUCKET, STORAGE_PREFIX, storagePathFromUrl } from './storage-path.js';
import type { ProtectionSnapshot, PurgeConfig, PurgeSummary } from './types.js';

const PROCEDURE_READ_BATCH = 1000;
const LINKED_EVENT_READ_BATCH = 64;
const STORAGE_READ_BATCH = 1000;
const STORAGE_DELETE_BATCH = 100;
const CRA_READ_BATCH = 500;
const CRA_DELETE_BATCH = 64;

type StorageObject = { id: string; name: string };
type CraEvent = { id: string };

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
    global: { headers: { 'X-Client-Info': 'rp-historical-purge/1.0.0' } },
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

    if (error) {
      throw new Error(`No se pudo proteger Procedimientos: ${error.message}`);
    }
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
    if (error) {
      throw new Error(`No se pudo proteger eventos vinculados: ${error.message}`);
    }
    for (const row of data ?? []) {
      const path = storagePathFromUrl(row.image_url as string | null);
      if (path) snapshot.protectedPaths.add(path);
    }
  }

  return snapshot;
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
): Promise<number> {
  let removed = 0;
  for (let index = 0; index < paths.length; index += STORAGE_DELETE_BATCH) {
    const chunk = paths.slice(index, index + STORAGE_DELETE_BATCH);
    const { error } = await client.storage.from(STORAGE_BUCKET).remove(chunk);
    if (error) throw new Error(`Storage API rechazó un lote: ${error.message}`);
    removed += chunk.length;
    await sleep(delayMs);
  }
  return removed;
}

async function purgeStorage(
  client: SupabaseClient,
  config: PurgeConfig,
  cutoffIso: string,
  protection: ProtectionSnapshot,
): Promise<{ scanned: number; deleted: number; protected: number; complete: boolean }> {
  let cursorId: string | null = null;
  let scanned = 0;
  let deleted = 0;
  let protectedCount = 0;

  while (true) {
    const objects = await fetchStoragePage(client, cutoffIso, cursorId);
    if (objects.length === 0) {
      return { scanned, deleted, protected: protectedCount, complete: true };
    }

    const latestProtection = await fetchProtection(client);
    mergeProtection(protection, latestProtection);
    const deletable: string[] = [];

    for (const object of objects) {
      scanned += 1;
      if (protection.protectedPaths.has(object.name)) protectedCount += 1;
      else if (deleted + deletable.length < config.maxStorageDeletesPerRun) {
        deletable.push(object.name);
      } else {
        return { scanned, deleted, protected: protectedCount, complete: false };
      }
    }

    if (config.mode === 'execute') {
      deleted += await removeStoragePaths(client, deletable, config.batchDelayMs);
    } else {
      deleted += deletable.length;
    }

    cursorId = objects.at(-1)?.id ?? null;
    logger.info('Página de Storage revisada', {
      scanned,
      [config.mode === 'execute' ? 'deleted' : 'wouldDelete']: deleted,
      protected: protectedCount,
    });

    if (objects.length < STORAGE_READ_BATCH) {
      return { scanned, deleted, protected: protectedCount, complete: true };
    }
  }
}

async function fetchCraPage(
  client: SupabaseClient,
  cutoffIso: string,
  cursorId: string | null,
): Promise<CraEvent[]> {
  let query = client
    .from('cra_events')
    .select('id')
    .lt('created_at', cutoffIso)
    .order('id', { ascending: true })
    .limit(CRA_READ_BATCH);

  if (cursorId) query = query.gt('id', cursorId);
  const { data, error } = await query;
  if (error) throw new Error(`No se pudieron leer eventos CRA: ${error.message}`);
  return (data ?? []).map((row) => ({ id: row.id as string })).filter((row) => isUuid(row.id));
}

async function deleteCraIds(
  client: SupabaseClient,
  ids: string[],
  delayMs: number,
): Promise<number> {
  let deleted = 0;
  for (let index = 0; index < ids.length; index += CRA_DELETE_BATCH) {
    const chunk = ids.slice(index, index + CRA_DELETE_BATCH);
    const { data, error } = await client.from('cra_events').delete().in('id', chunk).select('id');
    if (error) throw new Error(`No se pudo borrar un lote CRA: ${error.message}`);
    deleted += data?.length ?? 0;
    await sleep(delayMs);
  }
  return deleted;
}

async function purgeCra(
  client: SupabaseClient,
  config: PurgeConfig,
  cutoffIso: string,
  protection: ProtectionSnapshot,
): Promise<{ scanned: number; deleted: number; protected: number }> {
  let cursorId: string | null = null;
  let scanned = 0;
  let deleted = 0;
  let protectedCount = 0;

  while (deleted < config.maxCraDeletesPerRun) {
    const events = await fetchCraPage(client, cutoffIso, cursorId);
    if (events.length === 0) break;

    const latestProtection = await fetchProtection(client);
    mergeProtection(protection, latestProtection);
    const deletable: string[] = [];

    for (const event of events) {
      scanned += 1;
      if (protection.linkedEventIds.has(event.id)) protectedCount += 1;
      else if (deleted + deletable.length < config.maxCraDeletesPerRun) deletable.push(event.id);
      else break;
    }

    if (config.mode === 'execute') {
      deleted += await deleteCraIds(client, deletable, config.batchDelayMs);
    } else {
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

  return { scanned, deleted, protected: protectedCount };
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

  // Esta lectura ocurre antes de cualquier borrado. Si falla, todo se aborta.
  const protection = await fetchProtection(client);
  const storage = await purgeStorage(client, config, cutoff, protection);

  // Nunca se borran filas CRA mientras queden objetos Storage pendientes por el límite.
  const cra = storage.complete
    ? await purgeCra(client, config, cutoff, protection)
    : { scanned: 0, deleted: 0, protected: 0 };

  if (!storage.complete) {
    logger.warn('Storage alcanzó el límite; CRA queda intacto hasta completar Storage');
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
    storagePhaseComplete: storage.complete,
    craScanned: cra.scanned,
    craDeleted: cra.deleted,
    craProtected: cra.protected,
    craPhaseSkipped: !storage.complete,
  };
  logger.info('Purga histórica finalizada', summary as unknown as Record<string, unknown>);
  return summary;
}
