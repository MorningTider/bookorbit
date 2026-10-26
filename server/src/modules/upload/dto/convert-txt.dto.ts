import { IsIn, IsOptional } from 'class-validator';

import type { TxtConversionRequest } from '@bookorbit/types';

export class ConvertTxtDto implements TxtConversionRequest {
  @IsOptional()
  @IsIn(['auto', 'utf8', 'gb18030', 'utf16le', 'utf16be'])
  encoding?: 'auto' | 'utf8' | 'gb18030' | 'utf16le' | 'utf16be';

  @IsOptional()
  @IsIn(['auto', 'chinese', 'english', 'single'])
  chapters?: 'auto' | 'chinese' | 'english' | 'single';
}
