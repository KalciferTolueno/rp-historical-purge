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
  storagePhaseComplete: boolean;
  craScanned: number;
  craDeleted: number;
  craProtected: number;
  craPhaseSkipped: boolean;
}
