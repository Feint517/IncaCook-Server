import { IsEnum, Matches } from 'class-validator';

import { DayOfWeek } from '@common/enums/day-of-week.enum';

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** One row of `SellerOpeningHours`. Times are local, no zone, "HH:mm". */
export class CreateOpeningHoursDto {
  @IsEnum(DayOfWeek)
  dayOfWeek!: DayOfWeek;

  @Matches(TIME_PATTERN, { message: 'startTime must be HH:mm (00:00–23:59)' })
  startTime!: string;

  @Matches(TIME_PATTERN, { message: 'endTime must be HH:mm (00:00–23:59)' })
  endTime!: string;
}
