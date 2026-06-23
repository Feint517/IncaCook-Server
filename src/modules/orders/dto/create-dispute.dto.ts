import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export type DisputeType =
  | 'NEVER_RECEIVED'
  | 'WRONG_ORDER'
  | 'SPOILED_FOOD'
  | 'FOOD_POISONING'
  | 'SUBJECTIVE_DISSATISFACTION'
  | 'ALLERGEN_FALSE_DECLARATION'
  // System-created (Stripe webhook); not buyer-submittable.
  | 'CHARGEBACK';

export type DisputeStatus = 'OPEN' | 'AUTO_REFUNDED' | 'REJECTED' | 'ADMIN_REVIEW' | 'RESOLVED';

/** Body for `POST /v1/orders/:orderId/disputes` — a buyer post-delivery claim. */
export class CreateDisputeDto {
  @IsIn([
    'NEVER_RECEIVED',
    'WRONG_ORDER',
    'SPOILED_FOOD',
    'FOOD_POISONING',
    'SUBJECTIVE_DISSATISFACTION',
    'ALLERGEN_FALSE_DECLARATION',
  ])
  type!: DisputeType;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /** Storage paths of problem photos (resolve via publicImageUrl client-side). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  photoUrls?: string[];

  /** Storage paths of proof files (e.g. medical certificate for food poisoning). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  proofFileUrls?: string[];
}
