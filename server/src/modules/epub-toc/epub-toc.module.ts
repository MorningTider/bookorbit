import { Module } from '@nestjs/common';
import { BookModule } from '../book/book.module';
import { EpubModule } from '../reader/epub/epub.module';
import { FileWriteModule } from '../file-write/file-write.module';
import { ImportReviewModule } from '../import-review/import-review.module';
import { UploadModule } from '../upload/upload.module';
import { EpubTocController } from './epub-toc.controller';
import { EpubTocService } from './epub-toc.service';

@Module({
  imports: [BookModule, EpubModule, FileWriteModule, ImportReviewModule, UploadModule],
  controllers: [EpubTocController],
  providers: [EpubTocService],
})
export class EpubTocModule {}
