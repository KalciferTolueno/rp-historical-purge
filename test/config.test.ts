import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateCutoff, loadConfig } from '../src/config.js';

const validEnv = {
  SUPABASE_URL: 'http://192.168.1.205:8000/project/default/',
  SUPABASE_SERVICE_ROLE_KEY: 'secret-test-key',
};

test('la configuración es segura por defecto', () => {
  const config = loadConfig(validEnv);
  assert.equal(config.supabaseUrl, 'http://192.168.1.205:8000');
  assert.equal(config.mode, 'dry-run');
  assert.equal(config.retentionDays, 60);
  assert.equal(config.runOnStart, false);
});

test('rechaza una retención menor a 30 días', () => {
  assert.throws(() => loadConfig({ ...validEnv, RETENTION_DAYS: '29' }), /entre 30 y 3650/);
});

test('calcula un corte móvil exacto', () => {
  const cutoff = calculateCutoff(new Date('2026-09-01T12:00:00.000Z'), 60);
  assert.equal(cutoff.toISOString(), '2026-07-03T12:00:00.000Z');
});
