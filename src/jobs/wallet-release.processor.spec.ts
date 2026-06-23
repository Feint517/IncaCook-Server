import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WalletReleaseProcessor } from './wallet-release.processor';

import type { Job } from 'bullmq';

/**
 * The wallet-release processor delegates to the idempotent
 * `releaseDuePendingEntries()` and registers a single repeatable sweep job on
 * worker startup.
 */
describe('WalletReleaseProcessor', () => {
  let releaseDuePendingEntries: ReturnType<typeof vi.fn>;
  let enqueue: ReturnType<typeof vi.fn>;
  let proc: WalletReleaseProcessor;

  beforeEach(() => {
    releaseDuePendingEntries = vi.fn().mockResolvedValue({ released: 0 });
    enqueue = vi.fn().mockResolvedValue(undefined);
    proc = new WalletReleaseProcessor({ releaseDuePendingEntries } as never, { enqueue } as never);
  });

  it('wallet_release_sweep → releaseDuePendingEntries()', async () => {
    await proc.process({
      name: 'wallet_release_sweep',
      id: 'wallet-release-sweep',
    } as unknown as Job);
    expect(releaseDuePendingEntries).toHaveBeenCalledTimes(1);
  });

  it('registers a single repeatable sweep on startup (stable jobId)', async () => {
    await proc.onApplicationBootstrap();
    expect(enqueue).toHaveBeenCalledWith(
      'wallet-release',
      'wallet_release_sweep',
      {},
      expect.objectContaining({
        repeat: { every: 300000 },
        jobId: 'wallet-release-sweep',
      }),
    );
  });

  it('startup scheduling failure does not throw (in-process @Cron remains)', async () => {
    enqueue.mockRejectedValue(new Error('redis down'));
    await expect(proc.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
