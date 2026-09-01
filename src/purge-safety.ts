import { createHash } from 'node:crypto';
import { STORAGE_PREFIX, storagePathFromUrl } from './storage-path.js';

/**
 * Conserva una huella compacta de cada ruta todavía usada por CRA. Una colisión
 * sólo protege un archivo adicional; nunca provoca el borrado de uno referenciado.
 */
export function storagePathFingerprint(path: string): string {
  return createHash('sha256').update(path).digest('base64url').slice(0, 22);
}

export function referencedStorageFingerprint(
  imageUrl: string | null | undefined,
): string | null {
  const path = storagePathFromUrl(imageUrl);
  if (!path?.startsWith(STORAGE_PREFIX)) return null;
  return storagePathFingerprint(path);
}

export function isStoragePathProtected(
  path: string,
  procedurePaths: ReadonlySet<string>,
  remainingCraFingerprints: ReadonlySet<string>,
): 'procedure' | 'cra-reference' | null {
  if (procedurePaths.has(path)) return 'procedure';
  if (remainingCraFingerprints.has(storagePathFingerprint(path))) return 'cra-reference';
  return null;
}
