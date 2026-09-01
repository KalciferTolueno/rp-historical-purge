import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateDiskUsage, decideDiskPressureAction } from '../src/disk-monitor.js';

const policy = {
  triggerPercent: 90,
  rearmPercent: 85,
  cooldownMilliseconds: 6 * 60 * 60 * 1000,
};

test('calcula el porcentaje con la misma base de df', () => {
  const usage = calculateDiskUsage('/', {
    blocks: 1000n,
    bfree: 160n,
    bavail: 160n,
    bsize: 1024n,
  });
  assert.equal(usage.usedPercent, 84);
  assert.equal(usage.totalBytes, 1_024_000);
});

test('dispara al 90% y respeta el enfriamiento', () => {
  const first = decideDiskPressureAction(90, 1_000, policy, {
    pressureActive: false,
    lastTriggeredAt: null,
  });
  assert.equal(first.shouldTrigger, true);

  const tooSoon = decideDiskPressureAction(93, 2_000, policy, first.state);
  assert.equal(tooSoon.shouldTrigger, false);

  const afterCooldown = decideDiskPressureAction(
    93,
    1_000 + policy.cooldownMilliseconds,
    policy,
    first.state,
  );
  assert.equal(afterCooldown.shouldTrigger, true);
});

test('se rearma sólo cuando baja al 85%', () => {
  const active = { pressureActive: true, lastTriggeredAt: 1_000 };
  const middle = decideDiskPressureAction(88, 2_000, policy, active);
  assert.deepEqual(middle.state, active);
  assert.equal(middle.rearmed, false);

  const recovered = decideDiskPressureAction(85, 3_000, policy, active);
  assert.equal(recovered.rearmed, true);
  assert.deepEqual(recovered.state, { pressureActive: false, lastTriggeredAt: null });
});
