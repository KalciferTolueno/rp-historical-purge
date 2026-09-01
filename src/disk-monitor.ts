import { statfs } from 'node:fs/promises';
import type { DiskUsage } from './types.js';

export interface DiskMonitorPolicy {
  triggerPercent: number;
  rearmPercent: number;
  cooldownMilliseconds: number;
}

export interface DiskMonitorDecisionState {
  pressureActive: boolean;
  lastTriggeredAt: number | null;
}

export interface DiskMonitorDecision {
  shouldTrigger: boolean;
  rearmed: boolean;
  state: DiskMonitorDecisionState;
}

export function calculateDiskUsage(
  path: string,
  stats: { blocks: bigint; bfree: bigint; bavail: bigint; bsize: bigint },
): DiskUsage {
  const totalBytes = stats.blocks * stats.bsize;
  const freeBytes = stats.bfree * stats.bsize;
  const availableBytes = stats.bavail * stats.bsize;
  const usedBytes = totalBytes > freeBytes ? totalBytes - freeBytes : 0n;
  // Igual que `df`: el porcentaje considera el espacio reservado no disponible.
  const percentDenominator = usedBytes + availableBytes;
  const basisPoints =
    percentDenominator > 0n ? (usedBytes * 10000n) / percentDenominator : 0n;

  return {
    path,
    totalBytes: Number(totalBytes),
    usedBytes: Number(usedBytes),
    availableBytes: Number(availableBytes),
    usedPercent: Number(basisPoints) / 100,
  };
}

export async function readDiskUsage(path: string): Promise<DiskUsage> {
  const stats = await statfs(path, { bigint: true });
  return calculateDiskUsage(path, stats);
}

export function decideDiskPressureAction(
  usedPercent: number,
  nowMilliseconds: number,
  policy: DiskMonitorPolicy,
  previous: DiskMonitorDecisionState,
): DiskMonitorDecision {
  if (usedPercent <= policy.rearmPercent) {
    return {
      shouldTrigger: false,
      rearmed: previous.pressureActive || previous.lastTriggeredAt !== null,
      state: { pressureActive: false, lastTriggeredAt: null },
    };
  }

  if (usedPercent < policy.triggerPercent) {
    return { shouldTrigger: false, rearmed: false, state: previous };
  }

  const cooldownElapsed =
    previous.lastTriggeredAt === null ||
    nowMilliseconds - previous.lastTriggeredAt >= policy.cooldownMilliseconds;

  return {
    shouldTrigger: cooldownElapsed,
    rearmed: false,
    state: {
      pressureActive: true,
      lastTriggeredAt: cooldownElapsed ? nowMilliseconds : previous.lastTriggeredAt,
    },
  };
}

export function diskUsageLogContext(usage: DiskUsage): Record<string, unknown> {
  const gigabyte = 1000 ** 3;
  const gibibyte = 1024 ** 3;
  return {
    path: usage.path,
    totalGB: Number((usage.totalBytes / gigabyte).toFixed(1)),
    usedGB: Number((usage.usedBytes / gigabyte).toFixed(1)),
    availableGB: Number((usage.availableBytes / gigabyte).toFixed(1)),
    totalGiB: Number((usage.totalBytes / gibibyte).toFixed(1)),
    usedGiB: Number((usage.usedBytes / gibibyte).toFixed(1)),
    availableGiB: Number((usage.availableBytes / gibibyte).toFixed(1)),
    usedPercent: usage.usedPercent,
  };
}
