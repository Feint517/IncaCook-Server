import { DayOfWeek } from '@common/enums/day-of-week.enum';

import type { SellerOpeningHours } from '@prisma/client';

export class OpeningHoursResponseDto {
  dayOfWeek!: DayOfWeek;
  /** "HH:mm" local time, no zone. */
  startTime!: string;
  endTime!: string;

  static from(row: SellerOpeningHours): OpeningHoursResponseDto {
    return {
      dayOfWeek: row.dayOfWeek as DayOfWeek,
      startTime: formatTime(row.startTime),
      endTime: formatTime(row.endTime),
    };
  }
}

function formatTime(d: Date): string {
  // Postgres `time` columns come back as Date objects in UTC with the date
  // portion zeroed; we want just HH:mm in local time-of-day.
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
