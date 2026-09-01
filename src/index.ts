import { Cron } from 'croner';
import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { runPurge } from './purge-service.js';

const config = loadConfig();
const once = process.argv.includes('--once');
let running = false;

async function guardedRun(reason: 'startup' | 'schedule' | 'manual'): Promise<void> {
  if (running) {
    logger.warn('Se omitió una ejecución porque ya existe otra en curso', { reason });
    return;
  }

  running = true;
  try {
    await runPurge(config);
  } catch (error) {
    logger.error('La purga se abortó sin continuar', {
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
    if (once) process.exitCode = 1;
  } finally {
    running = false;
  }
}

if (once) {
  await guardedRun('manual');
} else {
  const job = new Cron(
    config.schedule,
    {
      timezone: config.timezone,
      protect: true,
    },
    () => guardedRun('schedule'),
  );

  logger.info('Programador iniciado', {
    schedule: config.schedule,
    timezone: config.timezone,
    mode: config.mode,
    nextRun: job.nextRun()?.toISOString() ?? null,
  });

  if (config.runOnStart) await guardedRun('startup');

  const shutdown = (): void => {
    logger.info('Deteniendo programador');
    job.stop();
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
