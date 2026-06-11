import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';

import { AllExceptionsFilter } from '@common/filters/all-exceptions.filter';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { IncaCookThrottleGuard } from '@common/guards/throttle.guard';
import { LoggingInterceptor } from '@common/interceptors/logging.interceptor';
import { TimeoutInterceptor } from '@common/interceptors/timeout.interceptor';
import { TransformInterceptor } from '@common/interceptors/transform.interceptor';
import { CorrelationIdMiddleware } from '@common/middleware/correlation-id.middleware';

import { ConfigModule } from '@config/config.module';

import { AuditModule } from '@infrastructure/audit/audit.module';
import { CacheModule } from '@infrastructure/cache/cache.module';
import { DatabaseModule } from '@infrastructure/database/database.module';
import { GeocodingModule } from '@infrastructure/geocoding/geocoding.module';
import { LoggerModule } from '@infrastructure/logger/logger.module';
import { EmailModule } from '@infrastructure/notifications/email/email.module';
import { FcmModule } from '@infrastructure/notifications/push/fcm.module';
import { SmsModule } from '@infrastructure/notifications/sms/sms.module';
import { QueueModule } from '@infrastructure/queue/queue.module';
import { RedisModule } from '@infrastructure/redis/redis.module';
import { StorageModule } from '@infrastructure/storage/storage.module';
import { StripeModule } from '@infrastructure/stripe/stripe.module';
import { SupabaseModule } from '@infrastructure/supabase/supabase.module';

import { AdminModule } from '@modules/admin/admin.module';
import { AuthModule } from '@modules/auth/auth.module';
import { BoostsModule } from '@modules/boosts/boosts.module';
import { BuyersModule } from '@modules/buyers/buyers.module';
import { CatalogModule } from '@modules/catalog/catalog.module';
import { ComplianceModule } from '@modules/compliance/compliance.module';
import { DeliveriesModule } from '@modules/deliveries/deliveries.module';
import { DriversModule } from '@modules/drivers/drivers.module';
import { FilesModule } from '@modules/files/files.module';
import { GeoModule } from '@modules/geo/geo.module';
import { HealthModule } from '@modules/health/health.module';
import { ListingsModule } from '@modules/listings/listings.module';
import { MessagingModule } from '@modules/messaging/messaging.module';
import { ModerationModule } from '@modules/moderation/moderation.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { OrdersModule } from '@modules/orders/orders.module';
import { PaymentsModule } from '@modules/payments/payments.module';
import { ReviewsModule } from '@modules/reviews/reviews.module';
import { SearchModule } from '@modules/search/search.module';
import { SellersModule } from '@modules/sellers/sellers.module';
import { SubscriptionsModule } from '@modules/subscriptions/subscriptions.module';
import { TrackingModule } from '@modules/tracking/tracking.module';
import { UsersModule } from '@modules/users/users.module';
import { WalletsModule } from '@modules/wallets/wallets.module';

@Module({
  imports: [
    // Core platform
    ConfigModule,
    LoggerModule,

    // Infrastructure (global)
    DatabaseModule,
    RedisModule,
    CacheModule,
    QueueModule,
    SupabaseModule,
    StorageModule,
    StripeModule,
    GeocodingModule,
    FcmModule,
    SmsModule,
    EmailModule,
    AuditModule,

    // Cross-cutting concerns
    EventEmitterModule.forRoot({ wildcard: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      useFactory: () => [
        {
          ttl: parseInt(process.env.RATE_LIMIT_TTL ?? '60', 10) * 1000,
          limit: parseInt(process.env.RATE_LIMIT_MAX ?? '100', 10),
        },
      ],
    }),

    // Domain modules
    AuthModule,
    HealthModule,
    UsersModule,
    SellersModule,
    DriversModule,
    BuyersModule,
    ListingsModule,
    OrdersModule,
    DeliveriesModule,
    PaymentsModule,
    WalletsModule,
    SubscriptionsModule,
    ReviewsModule,
    MessagingModule,
    NotificationsModule,
    ModerationModule,
    CatalogModule,
    SearchModule,
    TrackingModule,
    GeoModule,
    FilesModule,
    ComplianceModule,
    BoostsModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: IncaCookThrottleGuard },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TimeoutInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
