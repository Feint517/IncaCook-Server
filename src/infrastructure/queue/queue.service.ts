import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { JobsOptions, Queue } from 'bullmq';

import { redisConfig } from '@config/redis.config';

import { ALL_QUEUES, QueueName } from './queue.constants';

@Injectable()
export class QueueService {
  private readonly queues = new Map<QueueName, Queue>();

  constructor(@Inject(redisConfig.KEY) private readonly cfg: ConfigType<typeof redisConfig>) {
    const connection = this.cfg.url
      ? { url: this.cfg.url }
      : {
          host: this.cfg.host,
          port: this.cfg.port,
          password: this.cfg.password || undefined,
        };
    for (const name of ALL_QUEUES) {
      this.queues.set(name, new Queue(name, { connection }));
    }
  }

  getQueue(name: QueueName): Queue {
    const q = this.queues.get(name);
    if (!q) {
      throw new Error(`Queue ${name} is not registered`);
    }
    return q;
  }

  async enqueue<T>(name: QueueName, jobName: string, data: T, opts?: JobsOptions): Promise<void> {
    await this.getQueue(name).add(jobName, data, opts);
  }
}
