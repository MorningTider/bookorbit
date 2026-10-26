import type { FanqieAcquisitionRequest } from '@bookorbit/types';
import { IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';

export class AcquireTomatoDto implements FanqieAcquisitionRequest {
  @IsString()
  @Matches(/^\d{10,25}$/)
  bookId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  folderId?: number;
}
