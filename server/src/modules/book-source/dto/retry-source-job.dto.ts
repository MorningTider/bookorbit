import type { BookSourceRetryRequest } from '@bookorbit/types';
import { Equals, IsOptional } from 'class-validator';

export class RetrySourceJobDto implements BookSourceRetryRequest {
  @IsOptional()
  @Equals(true)
  confirmedImportNotCompleted?: true;
}
