import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { GITHUB_BOOK_FORMATS, type GithubBookFormat, type ImportResolution } from '@bookorbit/types';
import { ImportResolutionDto } from '../../import-review/dto/import-review.dto';

export class GithubRepositoryDto {
  @IsOptional() @IsInt() @Min(1) id?: number;
  @IsString() @MaxLength(120) label!: string;
  @IsString() @MaxLength(240) repository!: string;
  @IsString() @MaxLength(200) branch!: string;
  @IsString() @MaxLength(1000) path!: string;
  @IsArray() @ArrayNotEmpty() @ArrayUnique() @IsIn(GITHUB_BOOK_FORMATS, { each: true }) formats!: GithubBookFormat[];
  @IsBoolean() enabled!: boolean;
}
export class GithubSourceConfigDto {
  @IsString() @MaxLength(36) revision!: string;
  @IsBoolean() enabled!: boolean;
  @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => GithubRepositoryDto) repositories!: GithubRepositoryDto[];
}
export class GithubSourceSearchDto {
  @IsString() @MaxLength(200) query!: string;
  @IsOptional() @IsString() @Matches(/^(?:[a-f0-9]{40,64}|pending:[0-9]{1,20})$/) cursor?: string;
}
export class AcquireGithubDto {
  @IsInt() @Min(1) entryId!: number;
  @IsOptional() @IsString() @Matches(/^[a-f0-9]{40,64}$/) blobSha?: string | null;
  @IsOptional() @IsInt() @Min(1) folderId?: number;
  @IsOptional() @ValidateNested() @Type(() => ImportResolutionDto) importResolution?: ImportResolution;
}
