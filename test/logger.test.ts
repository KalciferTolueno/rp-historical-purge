import assert from 'node:assert/strict';
import test from 'node:test';
import { formatLogEntry, type LogEntry } from '../src/logger.js';

const timestamp = '2026-09-01T09:12:57.641Z';

test('presenta el programador en lenguaje claro', () => {
  const entry: LogEntry = {
    timestamp,
    level: 'info',
    message: 'Programador iniciado',
    context: {
      schedule: '30 3 * * 0',
      timezone: 'America/Santiago',
      mode: 'dry-run',
      nextRun: '2026-09-06T06:30:00.000Z',
    },
  };
  const output = formatLogEntry(entry, 'pretty', 'America/Santiago');
  assert.match(output, /PROGRAMADOR INICIADO/);
  assert.match(output, /SIMULACIÓN — no elimina ningún dato/);
  assert.match(output, /Domingo 03:30/);
  assert.match(output, /Próxima ejecución/);
});

test('resume una simulación sin sugerir que hubo borrado real', () => {
  const entry: LogEntry = {
    timestamp,
    level: 'info',
    message: 'Purga histórica finalizada',
    context: {
      mode: 'dry-run',
      cutoff: '2026-07-03T09:12:57.641Z',
      proceduresProtected: 25,
      pathsProtected: 25,
      linkedEventsProtected: 25,
      storageScanned: 100,
      storageDeleted: 80,
      storageProtected: 20,
      storageReferenced: 3,
      storagePhaseComplete: true,
      storagePhaseSkipped: false,
      storageSkipReason: null,
      craScanned: 100,
      craDeleted: 75,
      craProtected: 25,
      craPhaseComplete: true,
      craPhaseSkipped: false,
      remainingCraReferences: 15,
    },
  };
  const output = formatLogEntry(entry, 'pretty', 'America/Santiago');
  assert.match(output, /SIMULACIÓN COMPLETADA — no se eliminó ningún dato/);
  assert.match(output, /Archivos que se eliminarían: 80/);
  assert.match(output, /Eventos que se eliminarían: 75/);
  assert.match(output, /Procedimientos conservados: 25/);
  assert.match(output, /STORAGE \(SÓLO DESPUÉS DE CRA\)/);
  assert.match(output, /Conservados porque CRA aún los usa: 3/);
});

test('explica cuando Storage queda intacto por límite CRA', () => {
  const output = formatLogEntry(
    {
      timestamp,
      level: 'info',
      message: 'Purga histórica finalizada',
      context: {
        mode: 'dry-run',
        cutoff: '2026-07-03T09:12:57.641Z',
        craDeleted: 50000,
        craPhaseComplete: false,
        craPhaseSkipped: false,
        storageDeleted: 0,
        storagePhaseComplete: false,
        storagePhaseSkipped: true,
        storageSkipReason: 'cra-pending',
      },
    },
    'pretty',
    'America/Santiago',
  );

  assert.match(output, /Fase omitida: Sí/);
  assert.match(output, /Quedan eventos CRA antiguos por retirar; no se tocó Storage/);
});

test('presenta la revisión diaria de disco en horario de Chile', () => {
  const output = formatLogEntry(
    {
      timestamp,
      level: 'info',
      message: 'Monitor de disco iniciado',
      context: {
        path: '/',
        usedPercent: 65.1,
        usedGiB: 244.2,
        usableTotalGiB: 376.1,
        availableGiB: 131.9,
        triggerPercent: 90,
        rearmPercent: 85,
        checkSchedule: '30 4 * * *',
        nextCheck: '2026-09-04T08:30:00.000Z',
        cooldownHours: 6,
        pressureRetentionDays: 30,
      },
    },
    'pretty',
    'America/Santiago',
  );
  assert.match(output, /Todos los días 04:30/);
  assert.match(output, /Próxima revisión: 04-09-2026 04:30:00/);
});

test('conserva JSON para integración técnica', () => {
  const entry: LogEntry = {
    timestamp,
    level: 'warn',
    message: 'Prueba',
    context: { mode: 'execute' },
  };
  assert.deepEqual(JSON.parse(formatLogEntry(entry, 'json')), entry);
});
