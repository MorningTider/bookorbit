import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsString, Matches, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { EPUB_TOC_GROUP_LABEL_PATTERN, type EpubTocGroupStart, type OrganizeEpubTocRequest } from '@bookorbit/types';

export class EpubTocGroupDto implements EpubTocGroupStart {
  @IsInt() @Min(0) index!: number;
  @IsString() @MinLength(1) @MaxLength(500) @Matches(EPUB_TOC_GROUP_LABEL_PATTERN) label!: string;
}

export class OrganizeEpubTocDto implements OrganizeEpubTocRequest {
  @IsString() @Matches(/^[a-f0-9]{64}$/) expectedSha256!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100000) @ValidateNested({ each: true }) @Type(() => EpubTocGroupDto) groups!: EpubTocGroupDto[];
}
