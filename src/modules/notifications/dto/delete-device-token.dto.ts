import { IsString, MaxLength, MinLength } from 'class-validator';

/** Body for `DELETE /v1/device-tokens` — the token to unregister. */
export class DeleteDeviceTokenDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  token!: string;
}
