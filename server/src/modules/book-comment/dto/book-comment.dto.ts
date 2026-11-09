import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { BookCommentScope } from '@bookorbit/types';

export class CreateBookCommentDto {
  @IsUUID() clientId!: string;
  @IsString() @MinLength(1) @MaxLength(5000) body!: string;
  @IsOptional() @IsInt() @Min(1) parentId?: number;
  @IsOptional() @IsIn(['review', 'chapter', 'paragraph']) scope?: BookCommentScope;
  @IsOptional() @IsInt() @Min(1) bookFileId?: number;
  @IsOptional() @IsString() @MaxLength(2048) chapterHref?: string;
  @IsOptional() @IsString() @MaxLength(500) chapterTitle?: string;
  @IsOptional() @IsString() @MaxLength(8192) cfi?: string;
  @IsOptional() @IsString() @MaxLength(3000) quote?: string;
}

export class BookCommentQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) before?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) threadId?: number;
  @IsOptional() @IsIn(['review', 'chapter', 'paragraph']) scope?: BookCommentScope;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) bookFileId?: number;
  @IsOptional() @IsString() @MaxLength(2048) chapterHref?: string;
  @IsOptional() @IsString() @MaxLength(8192) cfi?: string;
}
