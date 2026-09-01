import type { PurgeConfig, PurgeMode } from './types.js';

const MIN_RETENTION_DAYS = 30;

function required(name: string, env: NodeJS.ProcessEnv): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Falta la variable obligatoria ${name}`);
  return value;
}

function integer(
  name: string,
  env: NodeJS.ProcessEnv,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} debe ser un entero entre ${minimum} y ${maximum}`);
  }
  return value;
}

function boolean(name: string, env: NodeJS.ProcessEnv, fallback: boolean): boolean {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} debe ser true o false`);
}

function normalizeSupabaseUrl(raw: string): string {
  return raw.replace(/\/+$/, '').replace(/\/project\/default$/i, '');
}

function mode(env: NodeJS.ProcessEnv): PurgeMode {
  const value = env.PURGE_MODE?.trim().toLowerCase() || 'dry-run';
  if (value !== 'dry-run' && value !== 'execute') {
    throw new Error('PURGE_MODE debe ser dry-run o execute');
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PurgeConfig {
  const timezone = env.TZ?.trim() || 'America/Santiago';
  try {
    new Intl.DateTimeFormat('es-CL', { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error(`TZ no es una zona horaria válida: ${timezone}`);
  }

  return {
    supabaseUrl: normalizeSupabaseUrl(required('SUPABASE_URL', env)),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY', env),
    mode: mode(env),
    retentionDays: integer('RETENTION_DAYS', env, 60, MIN_RETENTION_DAYS, 3650),
    schedule: env.PURGE_SCHEDULE?.trim() || '30 3 * * 0',
    timezone,
    runOnStart: boolean('RUN_ON_START', env, false),
    maxStorageDeletesPerRun: integer(
      'MAX_STORAGE_DELETES_PER_RUN',
      env,
      5000,
      1,
      200000,
    ),
    maxCraDeletesPerRun: integer(
      'MAX_CRA_DELETES_PER_RUN',
      env,
      50000,
      1,
      1000000,
    ),
    batchDelayMs: integer('BATCH_DELAY_MS', env, 150, 0, 10000),
  };
}

export function calculateCutoff(now: Date, retentionDays: number): Date {
  if (!Number.isInteger(retentionDays) || retentionDays < MIN_RETENTION_DAYS) {
    throw new Error(`La retención no puede ser menor a ${MIN_RETENTION_DAYS} días`);
  }
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}
