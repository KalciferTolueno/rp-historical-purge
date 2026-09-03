import { Cron } from 'croner';
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

function optionalCron(
  name: string,
  env: NodeJS.ProcessEnv,
  timezone: string,
): string | null {
  const raw = env[name];
  if (raw === undefined) return null;
  const value = raw.trim();
  if (!value) return null;
  try {
    const job = new Cron(value, { timezone, paused: true });
    job.stop();
  } catch {
    throw new Error(`${name} no es una expresión cron válida`);
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

  const retentionDays = integer('RETENTION_DAYS', env, 60, MIN_RETENTION_DAYS, 3650);
  const diskTriggerPercent = integer('DISK_TRIGGER_PERCENT', env, 90, 50, 99);
  const diskRearmPercent = integer('DISK_REARM_PERCENT', env, 85, 40, 98);
  if (diskRearmPercent >= diskTriggerPercent) {
    throw new Error('DISK_REARM_PERCENT debe ser menor que DISK_TRIGGER_PERCENT');
  }

  const diskPressureRetentionDays = integer(
    'DISK_PRESSURE_RETENTION_DAYS',
    env,
    Math.min(retentionDays, 30),
    MIN_RETENTION_DAYS,
    3650,
  );
  if (diskPressureRetentionDays > retentionDays) {
    throw new Error('DISK_PRESSURE_RETENTION_DAYS no puede superar RETENTION_DAYS');
  }

  return {
    supabaseUrl: normalizeSupabaseUrl(required('SUPABASE_URL', env)),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY', env),
    mode: mode(env),
    retentionDays,
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
    diskMonitorEnabled: boolean('DISK_MONITOR_ENABLED', env, false),
    diskPath: env.DISK_PATH?.trim() || '/',
    diskTriggerPercent,
    diskRearmPercent,
    diskCheckIntervalMinutes: integer('DISK_CHECK_INTERVAL_MINUTES', env, 5, 1, 1440),
    diskCheckSchedule: optionalCron('DISK_CHECK_SCHEDULE', env, timezone),
    diskTriggerCooldownHours: integer('DISK_TRIGGER_COOLDOWN_HOURS', env, 6, 1, 168),
    diskPressureRetentionDays,
  };
}

export function calculateCutoff(now: Date, retentionDays: number): Date {
  if (!Number.isInteger(retentionDays) || retentionDays < MIN_RETENTION_DAYS) {
    throw new Error(`La retención no puede ser menor a ${MIN_RETENTION_DAYS} días`);
  }
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}
