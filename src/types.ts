export type PurgeMode = 'dry-run' | 'execute';

export interface PurgeConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  mode: PurgeMode;
  retentionDays: number;
  schedule: string;
  timezone: string;
  runOnStart: boolean;
  maxStorageDeletesPerRun: number;
  maxCraDeletesPerRun: number;
  batchDelayMs: number;
  diskMonitorEnabled: boolean;
  diskPath: string;
  diskTriggerPercent: number;
  diskRearmPercent: number;
  diskCheckIntervalMinutes: number;
  diskCheckSchedule: string | null;
  diskTriggerCooldownHours: number;
  diskPressureRetentionDays: number;
}

export interface DiskUsage {
  path: string;
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usedPercent: number;
}

export interface ProtectionSnapshot {
  procedureCount: number;
  protectedPaths: Set<string>;
  linkedEventIds: Set<string>;
}

export interface PurgeSummary {
  mode: PurgeMode;
  startedAt: string;
  finishedAt: string;
  cutoff: string;
  proceduresProtected: number;
  pathsProtected: number;
  linkedEventsProtected: number;
  storageScanned: number;
  storageDeleted: number;
  storageProtected: number;
  storageReferenced: number;
  storagePhaseComplete: boolean;
  storagePhaseSkipped: boolean;
  storageSkipReason: string | null;
  craScanned: number;
  craDeleted: number;
  craProtected: number;
  craPhaseComplete: boolean;
  craPhaseSkipped: boolean;
  remainingCraReferences: number;
}
