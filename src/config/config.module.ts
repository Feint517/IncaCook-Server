import { Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import { appConfig } from './app.config';
import { databaseConfig } from './database.config';
import { validateEnv } from './env.validation';
import { firebaseConfig } from './firebase.config';
import { mapboxConfig } from './mapbox.config';
import { preludeConfig } from './prelude.config';
import { redisConfig } from './redis.config';
import { sentryConfig } from './sentry.config';
import { stripeConfig } from './stripe.config';
import { supabaseConfig } from './supabase.config';
import { twilioConfig } from './twilio.config';

@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      load: [
        appConfig,
        databaseConfig,
        redisConfig,
        supabaseConfig,
        stripeConfig,
        twilioConfig,
        preludeConfig,
        firebaseConfig,
        mapboxConfig,
        sentryConfig,
      ],
    }),
  ],
})
export class ConfigModule {}
