type LogLevel = 'info' | 'warn' | 'error';
export type LogFormat = 'pretty' | 'json';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

const SEPARATOR = '────────────────────────────────────────────────────────────';

const LABELS: Record<string, string> = {
  schedule: 'Horario programado',
  timezone: 'Zona horaria',
  mode: 'Modo',
  nextRun: 'Próxima ejecución',
  reason: 'Motivo',
  error: 'Detalle del error',
  cutoff: 'Fecha de corte',
  retentionDays: 'Días conservados',
  startedAt: 'Inicio',
  finishedAt: 'Fin',
  proceduresProtected: 'Procedimientos protegidos',
  pathsProtected: 'Imágenes protegidas',
  linkedEventsProtected: 'Eventos vinculados protegidos',
  storageScanned: 'Archivos Storage revisados',
  storageDeleted: 'Archivos Storage eliminados',
  storageProtected: 'Archivos Storage protegidos',
  storageReferenced: 'Archivos usados por eventos conservados',
  storagePhaseComplete: 'Fase Storage completa',
  storagePhaseSkipped: 'Fase Storage omitida',
  storageSkipReason: 'Motivo de omisión de Storage',
  craScanned: 'Eventos CRA revisados',
  craDeleted: 'Eventos CRA eliminados',
  craProtected: 'Eventos CRA protegidos',
  craPhaseComplete: 'Fase CRA completa',
  craPhaseSkipped: 'Fase CRA omitida',
  remainingCraReferences: 'Imágenes aún referenciadas por CRA',
  scanned: 'Revisados',
  deleted: 'Eliminados',
  wouldDelete: 'Se eliminarían',
  protected: 'Protegidos',
  referenced: 'Todavía en uso',
  path: 'Disco observado',
  totalGB: 'Capacidad física',
  usableTotalGB: 'Capacidad utilizable',
  usedGB: 'Espacio utilizado',
  availableGB: 'Espacio disponible',
  totalGiB: 'Capacidad física',
  usableTotalGiB: 'Capacidad utilizable',
  usedGiB: 'Espacio utilizado',
  availableGiB: 'Espacio disponible',
  usedPercent: 'Uso actual',
  triggerPercent: 'La purga se activa al',
  rearmPercent: 'El monitor se rearma al',
  checkEveryMinutes: 'Frecuencia de revisión',
  cooldownHours: 'Espera antes de repetir',
  pressureRetentionDays: 'Retención de emergencia',
};

const REASONS: Record<string, string> = {
  startup: 'Prueba solicitada al iniciar la aplicación',
  schedule: 'Horario semanal programado',
  manual: 'Ejecución manual',
  'disk-pressure': 'El disco alcanzó el umbral configurado',
};

function localDate(value: string, timezone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat('es-CL', {
    timeZone: timezone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? '00';
  return `${part('day')}-${part('month')}-${part('year')} ${part('hour')}:${part('minute')}:${part('second')}`;
}

function modeLabel(value: unknown): string {
  if (value === 'dry-run') return 'SIMULACIÓN — no elimina ningún dato';
  if (value === 'execute') return 'EJECUCIÓN REAL';
  return String(value);
}

function valueLabel(key: string, value: unknown, timezone: string): string {
  if (key === 'mode') return modeLabel(value);
  if (key === 'reason') return REASONS[String(value)] ?? String(value);
  if (['nextRun', 'cutoff', 'startedAt', 'finishedAt'].includes(key) && typeof value === 'string') {
    return `${localDate(value, timezone)} (${timezone})`;
  }
  if (key === 'schedule' && value === '30 3 * * 0') return 'Domingo 03:30 (30 3 * * 0)';
  if (key === 'storageSkipReason' && value === 'cra-pending') {
    return 'Quedan eventos CRA antiguos por retirar; no se tocó Storage';
  }
  if (key.endsWith('Percent')) return `${value}%`;
  if (key.endsWith('Minutes')) return `${value} minutos`;
  if (key.endsWith('Hours')) return `${value} horas`;
  if (key.endsWith('Days') || key === 'retentionDays') return `${value} días`;
  if (key.endsWith('GiB')) return `${value} GiB`;
  if (key.endsWith('GB')) return `${value} GB`;
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function labelFor(key: string, mode: unknown): string {
  if (key === 'storageDeleted' && mode === 'dry-run') return 'Archivos que se eliminarían';
  if (key === 'craDeleted' && mode === 'dry-run') return 'Eventos que se eliminarían';
  return LABELS[key] ?? key;
}

function contextLines(context: Record<string, unknown>, timezone: string): string[] {
  return Object.entries(context).map(
    ([key, value]) => `  ${labelFor(key, context.mode)}: ${valueLabel(key, value, timezone)}`,
  );
}

function diskLines(context: Record<string, unknown>): string[] {
  const lines = [
    `  Disco observado: ${String(context.path ?? '/')}`,
    `  Uso actual: ${String(context.usedPercent ?? '—')}%`,
  ];
  if (context.usedGiB !== undefined && context.usableTotalGiB !== undefined) {
    lines.push(
      `  Espacio: ${String(context.usedGiB)} GiB usados de ${String(context.usableTotalGiB)} GiB utilizables`,
    );
  }
  if (context.availableGiB !== undefined) {
    lines.push(`  Disponible: ${String(context.availableGiB)} GiB`);
  }
  if (context.triggerPercent !== undefined) {
    lines.push(`  Se activará al: ${String(context.triggerPercent)}%`);
  }
  if (context.rearmPercent !== undefined) {
    lines.push(`  Se rearmará al bajar a: ${String(context.rearmPercent)}%`);
  }
  if (context.checkEveryMinutes !== undefined) {
    lines.push(`  Revisión: cada ${String(context.checkEveryMinutes)} minutos`);
  }
  if (context.cooldownHours !== undefined) {
    lines.push(`  Espera antes de repetir: ${String(context.cooldownHours)} horas`);
  }
  if (context.pressureRetentionDays !== undefined || context.retentionDays !== undefined) {
    lines.push(
      `  Conservará: ${String(context.pressureRetentionDays ?? context.retentionDays)} días de historial`,
    );
  }
  if (context.mode !== undefined) lines.push(`  Modo: ${modeLabel(context.mode)}`);
  return lines;
}

function summaryLines(context: Record<string, unknown>, timezone: string): string[] {
  const dryRun = context.mode === 'dry-run';
  return [
    `  Resultado: ${dryRun ? 'SIMULACIÓN COMPLETADA — no se eliminó ningún dato' : 'PURGA REAL COMPLETADA'}`,
    `  Fecha de corte: ${valueLabel('cutoff', context.cutoff, timezone)}`,
    '',
    '  PROTECCIÓN',
    `    Procedimientos conservados: ${String(context.proceduresProtected ?? 0)}`,
    `    Imágenes protegidas: ${String(context.pathsProtected ?? 0)}`,
    `    Eventos vinculados conservados: ${String(context.linkedEventsProtected ?? 0)}`,
    '',
    '  BASE DE DATOS CRA',
    `    Eventos revisados: ${String(context.craScanned ?? 0)}`,
    `    ${dryRun ? 'Eventos que se eliminarían' : 'Eventos eliminados'}: ${String(context.craDeleted ?? 0)}`,
    `    Eventos protegidos: ${String(context.craProtected ?? 0)}`,
    `    Fase completa: ${valueLabel('craPhaseComplete', context.craPhaseComplete, timezone)}`,
    `    Fase omitida: ${valueLabel('craPhaseSkipped', context.craPhaseSkipped, timezone)}`,
    '',
    '  STORAGE (SÓLO DESPUÉS DE CRA)',
    `    Archivos revisados: ${String(context.storageScanned ?? 0)}`,
    `    ${dryRun ? 'Archivos que se eliminarían' : 'Archivos eliminados'}: ${String(context.storageDeleted ?? 0)}`,
    `    Protegidos por Procedimientos: ${String(context.storageProtected ?? 0)}`,
    `    Conservados porque CRA aún los usa: ${String(context.storageReferenced ?? 0)}`,
    `    Referencias CRA comprobadas: ${String(context.remainingCraReferences ?? 0)}`,
    `    Fase completa: ${valueLabel('storagePhaseComplete', context.storagePhaseComplete, timezone)}`,
    `    Fase omitida: ${valueLabel('storagePhaseSkipped', context.storagePhaseSkipped, timezone)}`,
    ...(context.storageSkipReason
      ? [`    Motivo: ${valueLabel('storageSkipReason', context.storageSkipReason, timezone)}`]
      : []),
  ];
}

function progressLine(entry: LogEntry, timezone: string): string {
  const context = entry.context ?? {};
  const area = entry.message.includes('Storage') ? 'STORAGE' : 'CRA';
  const actionKey = context.deleted !== undefined ? 'Eliminados' : 'Se eliminarían';
  const actionValue = context.deleted ?? context.wouldDelete ?? 0;
  const referenced =
    context.referenced === undefined ? '' : ` | Todavía en uso: ${String(context.referenced)}`;
  return `[${localDate(entry.timestamp, timezone)}] PROGRESO ${area} | Revisados: ${String(context.scanned ?? 0)} | ${actionKey}: ${String(actionValue)} | Protegidos: ${String(context.protected ?? 0)}${referenced}`;
}

export function formatLogEntry(
  entry: LogEntry,
  format: LogFormat,
  timezone = process.env.TZ?.trim() || 'America/Santiago',
): string {
  if (format === 'json') return JSON.stringify(entry);

  if (entry.message === 'Página de Storage revisada' || entry.message === 'Página CRA revisada') {
    return progressLine(entry, timezone);
  }

  if (entry.message === 'Comprobación de referencias CRA en progreso') {
    const context = entry.context ?? {};
    return `[${localDate(entry.timestamp, timezone)}] PROGRESO REFERENCIAS CRA | Filas revisadas: ${String(context.scanned ?? 0)} | Imágenes aún en uso: ${String(context.referenced ?? 0)}`;
  }

  const level = entry.level === 'warn' ? 'ATENCIÓN' : entry.level === 'error' ? 'ERROR' : 'INFO';
  const title = entry.message.toLocaleUpperCase('es-CL');
  const context = entry.context ?? {};
  let lines: string[];

  if (entry.message === 'Monitor de disco iniciado' || entry.message.includes('Umbral de disco')) {
    lines = diskLines(context);
  } else if (entry.message === 'Purga histórica finalizada') {
    lines = summaryLines(context, timezone);
  } else {
    lines = contextLines(context, timezone);
  }

  return [
    SEPARATOR,
    `[${localDate(entry.timestamp, timezone)}] ${level} | ${title}`,
    ...lines,
    SEPARATOR,
  ].join('\n');
}

function selectedFormat(): LogFormat {
  return process.env.LOG_FORMAT?.trim().toLowerCase() === 'json' ? 'json' : 'pretty';
}

function write(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(context ? { context } : {}),
  };
  const output = formatLogEntry(entry, selectedFormat());
  if (level === 'error') console.error(output);
  else if (level === 'warn') console.warn(output);
  else console.log(output);
}

export const logger = {
  info: (message: string, context?: Record<string, unknown>) => write('info', message, context),
  warn: (message: string, context?: Record<string, unknown>) => write('warn', message, context),
  error: (message: string, context?: Record<string, unknown>) => write('error', message, context),
};
