import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger as PinoLogger } from 'nestjs-pino';

import 'reflect-metadata';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const sentryDsn = process.env.SENTRY_DSN;
  if (sentryDsn) {
    Sentry.init({
      dsn: sentryDsn,
      environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
      tracesSampleRate: 0.1,
      profilesSampleRate: 0.1,
      integrations: [nodeProfilingIntegration()],
    });
  }

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });

  app.useLogger(app.get(PinoLogger));

  const config = app.get(ConfigService);
  const port = config.get<number>('app.port', 3000);
  const allowedOrigins = config.get<string[]>('app.allowedOrigins', []);

  app.use(helmet());
  app.use(compression());
  app.use(cookieParser());

  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.enableShutdownHooks();

  await app.listen(port, '0.0.0.0');

  const logger = app.get(PinoLogger);
  logger.log(`🚀 incacook-api listening on http://0.0.0.0:${port} (${process.env.NODE_ENV})`);
}

bootstrap().catch((err) => {
  console.error('Failed to bootstrap', err);
  process.exit(1);
});
