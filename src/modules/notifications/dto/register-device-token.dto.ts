import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

/** Platforms a push token can belong to. v1 ships ANDROID. */
export const DEVICE_PLATFORMS = ['ANDROID', 'IOS', 'WEB'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

/**
 * Body for `POST /v1/device-tokens`. The FCM registration token plus the
 * platform it came from. Re-posting the same token is idempotent — the
 * server upserts on the unique `token` (see DeviceTokensService.register).
 */
export class RegisterDeviceTokenDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  token!: string;

  @IsIn(DEVICE_PLATFORMS)
  platform!: DevicePlatform;
}
