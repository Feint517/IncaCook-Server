import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Body for admin dispute actions (approve-refund / reject / resolve). */
export class DisputeActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
