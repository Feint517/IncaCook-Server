import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Job } from 'bullmq';

import { QueueNames, WalletJobNames } from '@infrastructure/queue/queue.constants';
import { QueueService } from '@infrastructure/queue/queue.service';

import { WalletService } from '@modules/wallets/wallets.service';

/** Wallet release sweep cadence — matches the in-process @Cron fallback. */
const SWEEP_EVERY_MS = 5 * 60_000;

/**
 * Durable wallet-release sweep. On worker startup it registers a single
 * repeatable BullMQ job; each run delegates to the idempotent
 * `releaseDuePendingEntries()`. This is the restart-resilient equivalent of the
 * in-process `@Cron` in WalletService (which remains as the API-side fallback).
 * Running both is safe — the sweep is idempotent.
 */
@Processor(QueueNames.WalletRelease)
export class WalletReleaseProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(WalletReleaseProcessor.name);

  constructor(
    private readonly wallet: WalletService,
    private readonly queue: QueueService,
  ) {
    super();
  }

  /** Registers the repeatable sweep once (stable jobId → no duplicates). */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.queue.enqueue(
        QueueNames.WalletRelease,
        WalletJobNames.WalletReleaseSweep,
        {},
        {
          repeat: { every: SWEEP_EVERY_MS },
          jobId: 'wallet-release-sweep',
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
      this.logger.log(
        `[Jobs] scheduled name=${WalletJobNames.WalletReleaseSweep} id=wallet-release-sweep delayMs=${SWEEP_EVERY_MS} (repeatable)`,
      );
    } catch (err) {
      this.logger.warn(
        `[Jobs] wallet release repeatable scheduling failed (in-process @Cron remains): ${(err as Error).message}`,
      );
    }
  }

  async process(job: Job): Promise<void> {
    this.logger.log(`[Jobs] processing name=${job.name} id=${job.id}`);
    await this.wallet.releaseDuePendingEntries();
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job): void {
    this.logger.log(`[Jobs] completed name=${job.name} id=${job.id}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, err: Error): void {
    this.logger.error(`[Jobs] failed name=${job?.name} id=${job?.id} error=${err?.message}`);
  }
}
