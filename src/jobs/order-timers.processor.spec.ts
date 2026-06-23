import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrderTimersProcessor } from './order-timers.processor';

import type { Job } from 'bullmq';

/**
 * The durable timer processor must delegate to the matching idempotent
 * OrdersService method and never run business logic itself. Because the BullMQ
 * job and the in-process timer can both fire, running the same job twice must
 * just call the (idempotent) method again.
 */
describe('OrderTimersProcessor', () => {
  let handleNoDriverTimeout: ReturnType<typeof vi.fn>;
  let autoCancelNoResponse: ReturnType<typeof vi.fn>;
  let handleDriverDeliveryTimeout: ReturnType<typeof vi.fn>;
  let proc: OrderTimersProcessor;

  beforeEach(() => {
    handleNoDriverTimeout = vi.fn().mockResolvedValue(undefined);
    autoCancelNoResponse = vi.fn().mockResolvedValue(undefined);
    handleDriverDeliveryTimeout = vi.fn().mockResolvedValue(undefined);
    proc = new OrderTimersProcessor({
      handleNoDriverTimeout,
      autoCancelNoResponse,
      handleDriverDeliveryTimeout,
    } as never);
  });

  const job = (name: string, data: Record<string, unknown>): Job =>
    ({ name, id: 'job-1', data }) as unknown as Job;

  it('no_driver_timeout → handleNoDriverTimeout(orderId)', async () => {
    await proc.process(job('no_driver_timeout', { orderId: 'o1' }));
    expect(handleNoDriverTimeout).toHaveBeenCalledWith('o1');
  });

  it('no_driver_buyer_response_timeout → autoCancelNoResponse(orderId)', async () => {
    await proc.process(job('no_driver_buyer_response_timeout', { orderId: 'o1' }));
    expect(autoCancelNoResponse).toHaveBeenCalledWith('o1');
  });

  it('driver_delivery_timeout → handleDriverDeliveryTimeout(deliveryId)', async () => {
    await proc.process(job('driver_delivery_timeout', { deliveryId: 'd1' }));
    expect(handleDriverDeliveryTimeout).toHaveBeenCalledWith('d1');
  });

  it('duplicate execution simply re-invokes the idempotent method', async () => {
    const j = job('no_driver_timeout', { orderId: 'o1' });
    await proc.process(j);
    await proc.process(j);
    expect(handleNoDriverTimeout).toHaveBeenCalledTimes(2);
    expect(handleNoDriverTimeout).toHaveBeenCalledWith('o1');
  });

  it('ignores an unknown job name without calling any handler', async () => {
    await proc.process(job('mystery', {}));
    expect(handleNoDriverTimeout).not.toHaveBeenCalled();
    expect(autoCancelNoResponse).not.toHaveBeenCalled();
    expect(handleDriverDeliveryTimeout).not.toHaveBeenCalled();
  });
});
