import { Module } from '@nestjs/common';
import { LoggerModule as PinoModule } from 'nestjs-pino';

import { pinoLoggerOptions } from './pino-logger.service';

@Module({
  imports: [PinoModule.forRoot(pinoLoggerOptions)],
  exports: [PinoModule],
})
export class LoggerModule {}
