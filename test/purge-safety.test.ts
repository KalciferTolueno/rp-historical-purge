import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isStoragePathProtected,
  referencedStorageFingerprint,
  storagePathFingerprint,
} from '../src/purge-safety.js';

test('protege una ruta usada por cualquier evento CRA conservado', () => {
  const path = 'events/2026/alert.jpg';
  const remainingReferences = new Set([storagePathFingerprint(path)]);

  assert.equal(isStoragePathProtected(path, new Set(), remainingReferences), 'cra-reference');
  assert.equal(isStoragePathProtected('events/orphan.jpg', new Set(), remainingReferences), null);
});

test('Procedimientos tiene prioridad y sus rutas nunca se consideran borrables', () => {
  const path = 'events/procedure.jpg';
  assert.equal(
    isStoragePathProtected(path, new Set([path]), new Set([storagePathFingerprint(path)])),
    'procedure',
  );
});

test('normaliza variantes de URL antes de comparar referencias', () => {
  const publicUrl =
    'http://supabase.local/storage/v1/object/public/images/events/shared%20image.jpg';
  const signedUrl =
    'http://supabase.local/storage/v1/object/sign/images/events/shared%20image.jpg?token=x';

  assert.equal(referencedStorageFingerprint(publicUrl), referencedStorageFingerprint(signedUrl));
  assert.equal(referencedStorageFingerprint('https://external.example/image.jpg'), null);
});
