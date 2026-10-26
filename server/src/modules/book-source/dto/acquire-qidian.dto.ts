import { IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';

export class AcquireQidianDto {
  @IsString()
  @Matches(/^[1-9]\d{0,15}$/)
  bookId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  folderId?: number;
}
