import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import type { ImportResolution } from '@bookorbit/types';
import { ImportResolutionDto } from '../../import-review/dto/import-review.dto';
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
  @IsOptional()
  @ValidateNested()
  @Type(() => ImportResolutionDto)
  importResolution?: ImportResolution;
}
