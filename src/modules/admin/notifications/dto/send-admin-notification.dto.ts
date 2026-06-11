import { SellerCategory } from '@prisma/client';
import { IsEnum, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Audience selector for an admin mass notification. */
export enum NotificationTarget {
  All = 'ALL',
  Buyers = 'BUYERS',
  Sellers = 'SELLERS',
  Drivers = 'DRIVERS',
  RecurringUsers = 'RECURRING_USERS',
  MonoUsers = 'MONO_USERS',
  TopSellers = 'TOP_SELLERS',
  Category = 'CATEGORY',
  City = 'CITY',
}

/** Body for `POST /v1/admin/notifications/send`. */
export class SendAdminNotificationDto {
  @IsEnum(NotificationTarget)
  target!: NotificationTarget;

  /** Required when target = CATEGORY. */
  @IsOptional()
  @IsEnum(SellerCategory)
  category?: SellerCategory;

  /** Required when target = CITY. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  body!: string;

  /** Optional extra data payload (values are coerced to strings for FCM). */
  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}
