import { IsIn, IsOptional } from 'class-validator';

import type { TxtConversionRequest } from '@bookorbit/types';

export class ConvertTxtDto implements TxtConversionRequest {
  @IsOptional()
  @IsIn(['auto', 'utf8', 'gb18030', 'utf16le'])
  encoding?: 'auto' | 'utf8' | 'gb18030' | 'utf16le';

  @IsOptional()
  @IsIn(['auto', 'single'])
  chapters?: 'auto' | 'single';
}
