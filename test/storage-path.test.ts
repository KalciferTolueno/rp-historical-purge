import assert from 'node:assert/strict';
import test from 'node:test';
import { storagePathFromUrl } from '../src/storage-path.js';

test('extrae rutas públicas y firmadas del bucket images', () => {
  assert.equal(
    storagePathFromUrl(
      'http://supabase.local/storage/v1/object/public/images/events/2026/alert.jpg',
    ),
    'events/2026/alert.jpg',
  );
  assert.equal(
    storagePathFromUrl(
      'http://supabase.local/storage/v1/object/sign/images/events/legacy%20image.jpg?token=x',
    ),
    'events/legacy image.jpg',
  );
});

test('ignora URLs de otros buckets', () => {
  assert.equal(
    storagePathFromUrl('http://supabase.local/storage/v1/object/public/private/events/a.jpg'),
    null,
  );
});

test('acepta rutas relativas antiguas de forma conservadora', () => {
  assert.equal(storagePathFromUrl('images/events/a.jpg?x=1'), 'events/a.jpg');
  assert.equal(storagePathFromUrl('events/a.jpg'), 'events/a.jpg');
});
