import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import {
  OrderTimerJobData,
  QueueNames,
  TimerJobNames,
} from '@infrastructure/queue/queue.constants';

import { OrdersService } from '@modules/orders/orders.service';

/**
 * Processes the durable order/delivery timer jobs that mirror the in-process
 * watchdogs. Each branch delegates to the matching idempotent service method —
 * NO business logic lives here. Because the BullMQ job and the in-process timer
 * may both fire, the underlying methods are safe to run more than once (no
 * double refund / cancel / pay / strike).
 */
@Processor(QueueNames.OrderTimeout)
export class OrderTimersProcessor extends WorkerHost {
  private readonly logger = new Logger(OrderTimersProcessor.name);

  constructor(private readonly orders: OrdersService) {
    super();
  }

  async process(job: Job<OrderTimerJobData>): Promise<void> {
    this.logger.log(`[Jobs] processing name=${job.name} id=${job.id}`);
    const { orderId, deliveryId } = job.data ?? {};

    switch (job.name) {
      case TimerJobNames.NoDriverTimeout:
        if (orderId) await this.orders.handleNoDriverTimeout(orderId);
        return;
      case TimerJobNames.NoDriverBuyerResponseTimeout:
        if (orderId) await this.orders.autoCancelNoResponse(orderId);
        return;
      case TimerJobNames.DriverDeliveryTimeout:
        if (deliveryId) await this.orders.handleDriverDeliveryTimeout(deliveryId);
        return;
      default:
        this.logger.warn(`[Jobs] unknown name=${job.name} id=${job.id}`);
    }
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
