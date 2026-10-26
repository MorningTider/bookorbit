import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Length, Matches, Min, ValidateNested } from 'class-validator';
import type { PublicChapterRule } from '@bookorbit/types';

export class PublicChapterRuleDto implements PublicChapterRule {
  @IsString() @Matches(/^[a-z][a-z0-9-]{0,6}$/) key!: string;
  @IsString() @Length(1, 80) label!: string;
  @IsString() @Length(9, 200) origin!: string;
  @IsString() @Length(5, 200) bookPath!: string;
  @IsString() @Length(5, 200) catalogPath!: string;
  @IsString() @Length(1, 200) titleSelector!: string;
  @IsString() @Length(1, 200) authorSelector!: string;
  @IsString() @Length(1, 200) chapterLinkSelector!: string;
  @IsString() @Length(1, 200) chapterPublicSelector!: string;
  @IsString() @Length(1, 200) chapterRestrictedSelector!: string;
  @IsString() @Length(1, 200) chapterHeadingSelector!: string;
  @IsString() @Length(1, 200) publicPageSelector!: string;
  @IsString() @Length(1, 200) restrictedPageSelector!: string;
  @IsString() @Length(1, 200) contentSelector!: string;
}
export class PublicChapterRulesDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PublicChapterRuleDto)
  sources!: PublicChapterRuleDto[];
}
export class AcquireRuleChaptersDto {
  @IsString() @Matches(/^[a-z][a-z0-9-]{0,6}$/) source!: string;
  @IsString() @Matches(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,15}$/) bookId!: string;
  @IsOptional() @IsInt() @Min(1) folderId?: number;
}
