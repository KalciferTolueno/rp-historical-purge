export const STORAGE_BUCKET = 'images';
export const STORAGE_PREFIX = 'events/';

const STORAGE_PATH_RE =
  /\/storage\/v1\/(?:object|render\/image)\/(?:public|sign)\/([^/]+)\/(.+?)(?:[?#]|$)/i;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function storagePathFromUrl(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  const value = url.trim();
  const match = value.match(STORAGE_PATH_RE);

  if (match) {
    const bucket = safeDecode(match[1] ?? '');
    if (bucket !== STORAGE_BUCKET) return null;
    const path = safeDecode(match[2] ?? '').replace(/^\/+/, '');
    return path || null;
  }

  try {
    const parsed = new URL(value);
    const marker = `/${STORAGE_BUCKET}/`;
    const markerIndex = parsed.pathname.indexOf(marker);
    if (markerIndex < 0) return null;
    return safeDecode(parsed.pathname.slice(markerIndex + marker.length)).replace(/^\/+/, '') || null;
  } catch {
    const relative = value.split(/[?#]/, 1)[0]?.replace(/^\/+/, '') ?? '';
    const path = relative.startsWith(`${STORAGE_BUCKET}/`)
      ? relative.slice(STORAGE_BUCKET.length + 1)
      : relative;
    return safeDecode(path).replace(/^\/+/, '') || null;
  }
}

export function isUuid(value: string | null | undefined): value is string {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      ),
  );
}
