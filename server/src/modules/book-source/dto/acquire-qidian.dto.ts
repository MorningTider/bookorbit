import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import type { ImportResolution } from '@bookorbit/types';
import { ImportResolutionDto } from '../../import-review/dto/import-review.dto';
import { IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';

export class AcquireQidianDto {
  @IsString()
  @Matches(/^[1-9]\d{0,15}$/)
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
