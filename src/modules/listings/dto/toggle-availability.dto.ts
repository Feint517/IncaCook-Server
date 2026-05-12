import { IsBoolean } from 'class-validator';

/** Body for `PATCH /v1/listings/:id/availability` — quick on/off toggle. */
export class ToggleAvailabilityDto {
  @IsBoolean()
  isAvailable!: boolean;
}
