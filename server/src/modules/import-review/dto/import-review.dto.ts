import { BadRequestException } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { ImportDuplicatePolicy, ImportIdentity, ImportOrigin } from '@bookorbit/types';

export class ImportPolicyDto implements ImportDuplicatePolicy {
  @IsBoolean() contentHash!: boolean;
  @IsBoolean() sourceIdentity!: boolean;
  @IsBoolean() isbn!: boolean;
  @IsBoolean() titleAndAuthor!: boolean;
  @IsBoolean() sameMediaKind!: boolean;
  @IsBoolean() acrossLibraries!: boolean;
}
export class LibraryImportPolicyDto {
  @IsOptional() @ValidateNested() @Type(() => ImportPolicyDto) override!: ImportPolicyDto | null;
}
export class ImportOriginDto implements ImportOrigin {
  @IsString() @Matches(/^[a-z][a-z0-9_.-]{0,49}$/) provider!: string;
  @IsString() @Length(1, 255) @Matches(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/) id!: string;
}
export class ImportIdentityDto implements ImportIdentity {
  @IsOptional() @IsString() @MaxLength(1000) title?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(500, { each: true }) authors?: string[];
  @IsOptional() @IsString() @MaxLength(32) isbn10?: string;
  @IsOptional() @IsString() @MaxLength(32) isbn13?: string;
  @IsOptional() @ValidateNested() @Type(() => ImportOriginDto) origin?: ImportOriginDto;
  @IsOptional() @IsString() @MaxLength(20) format?: string;
}
export class ImportCandidateCheckDto {
  @IsString() @Length(1, 255) key!: string;
  @ValidateNested() @Type(() => ImportIdentityDto) identity!: ImportIdentityDto;
}
export class CheckImportCandidatesDto {
  @IsInt() @Min(1) libraryId!: number;
  @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => ImportCandidateCheckDto) candidates!: ImportCandidateCheckDto[];
}
export class ImportResolutionDto {
  @IsIn(['new', 'attach', 'replace']) action!: 'new' | 'attach' | 'replace';
  @IsOptional() @IsInt() @Min(1) bookId?: number;
  @IsOptional() @IsInt() @Min(1) fileId?: number;
  @IsOptional() @IsString() @Matches(/^[a-f0-9]{64}$/) expectedSha256?: string;
}

export function importResolutionFromDto(dto: ImportResolutionDto): import('@bookorbit/types').ImportResolution {
  if (dto.action === 'new' && dto.bookId === undefined && dto.fileId === undefined && dto.expectedSha256 === undefined) return { action: 'new' };
  if (dto.action === 'attach' && dto.bookId && dto.fileId === undefined && dto.expectedSha256 === undefined)
    return { action: 'attach', bookId: dto.bookId };
  if (dto.action === 'replace' && dto.bookId && dto.fileId && dto.expectedSha256)
    return { action: 'replace', bookId: dto.bookId, fileId: dto.fileId, expectedSha256: dto.expectedSha256 };
  throw new BadRequestException('The import action and target fields do not match');
}

export class ImportFilesPageDto {
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) cursor?: number;
  @IsOptional() @IsString() @MaxLength(20) format?: string;
}
