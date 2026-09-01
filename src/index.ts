import { Cron } from 'croner';
import { loadConfig } from './config.js';
import {
  decideDiskPressureAction,
  diskUsageLogContext,
  readDiskUsage,
  type DiskMonitorDecisionState,
} from './disk-monitor.js';
import { logger } from './logger.js';
import { runPurge } from './purge-service.js';

const config = loadConfig();
const once = process.argv.includes('--once');
let running = false;
let checkingDisk = false;
let diskTimer: NodeJS.Timeout | null = null;
let diskState: DiskMonitorDecisionState = {
  pressureActive: false,
  lastTriggeredAt: null,
};

type RunOutcome = 'completed' | 'failed' | 'skipped';

async function guardedRun(
  reason: 'startup' | 'schedule' | 'manual' | 'disk-pressure',
  retentionDays = config.retentionDays,
): Promise<RunOutcome> {
  if (running) {
    logger.warn('Se omitió una ejecución porque ya existe otra en curso', { reason });
    return 'skipped';
  }

  running = true;
  try {
    logger.info('Ejecución de purga solicitada', {
      reason,
      mode: config.mode,
      retentionDays,
    });
    await runPurge({ ...config, retentionDays });
    return 'completed';
  } catch (error) {
    logger.error('La purga se abortó sin continuar', {
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
    if (once) process.exitCode = 1;
    return 'failed';
  } finally {
    running = false;
  }
}

async function checkDisk(isInitialCheck = false): Promise<void> {
  if (!config.diskMonitorEnabled || checkingDisk) return;
  checkingDisk = true;

  try {
    const usage = await readDiskUsage(config.diskPath);
    const previousDiskState = diskState;
    const decision = decideDiskPressureAction(
      usage.usedPercent,
      Date.now(),
      {
        triggerPercent: config.diskTriggerPercent,
        rearmPercent: config.diskRearmPercent,
        cooldownMilliseconds: config.diskTriggerCooldownHours * 60 * 60 * 1000,
      },
      diskState,
    );
    diskState = decision.state;

    if (isInitialCheck) {
      logger.info('Monitor de disco iniciado', {
        ...diskUsageLogContext(usage),
        triggerPercent: config.diskTriggerPercent,
        rearmPercent: config.diskRearmPercent,
        checkEveryMinutes: config.diskCheckIntervalMinutes,
        cooldownHours: config.diskTriggerCooldownHours,
        pressureRetentionDays: config.diskPressureRetentionDays,
      });
    } else if (decision.rearmed) {
      logger.info('Monitor de disco rearmado', diskUsageLogContext(usage));
    }

    if (decision.shouldTrigger) {
      logger.warn('Umbral de disco alcanzado; se solicita purga protegida', {
        ...diskUsageLogContext(usage),
        triggerPercent: config.diskTriggerPercent,
        retentionDays: config.diskPressureRetentionDays,
        mode: config.mode,
      });
      const outcome = await guardedRun('disk-pressure', config.diskPressureRetentionDays);
      if (outcome === 'skipped') {
        // Una purga programada ya estaba trabajando. Reintentar el disparo por
        // presión en el siguiente chequeo, sin consumir el enfriamiento.
        diskState = {
          pressureActive: true,
          lastTriggeredAt: previousDiskState.lastTriggeredAt,
        };
      }
    }
  } catch (error) {
    logger.error('No se pudo revisar el uso del disco; no se ejecuta purga por presión', {
      path: config.diskPath,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    checkingDisk = false;
  }
}

async function startDiskMonitor(): Promise<void> {
  if (!config.diskMonitorEnabled) {
    logger.info('Monitor de disco desactivado');
    return;
  }

  await checkDisk(true);
  diskTimer = setInterval(
    () => void checkDisk(false),
    config.diskCheckIntervalMinutes * 60 * 1000,
  );
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
    async () => {
      await guardedRun('schedule');
    },
  );

  logger.info('Programador iniciado', {
    schedule: config.schedule,
    timezone: config.timezone,
    mode: config.mode,
    nextRun: job.nextRun()?.toISOString() ?? null,
  });

  if (config.runOnStart) await guardedRun('startup');
  await startDiskMonitor();

  const shutdown = (): void => {
    logger.info('Deteniendo programador');
    job.stop();
    if (diskTimer) clearInterval(diskTimer);
    process.exit(0);
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
