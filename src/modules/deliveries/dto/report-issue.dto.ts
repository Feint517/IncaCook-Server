import { OrderStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { IssueSeverity } from '@common/enums/issue-severity.enum';

/**
 * Body for `POST /v1/drivers/me/deliveries/:id/report-issue`. Driver reports
 * a problem mid-delivery.
 *
 * `issueCode` is free text from the Flutter `issue_catalog.dart` catalog
 * ("restaurant_closed", "buyer_unreachable", …). The catalog grows
 * frequently, so we don't enumerate it on the backend.
 *
 * `severity = ABORT` flags the order for admin intervention but does NOT
 * automatically cancel/refund — that's a human call. Service just records
 * the issue.
 */
export class ReportIssueDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  issueCode!: string;

  @IsEnum(IssueSeverity)
  severity!: IssueSeverity;

  /** The order's current status when the issue was filed. */
  @IsEnum(OrderStatus)
  stageWhenReported!: OrderStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  freeText?: string;
}
