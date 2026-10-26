import { ChapterRuleRegistry } from './chapter-rule-registry.service';
import { ChapterRulesController } from './chapter-rules.controller';
import { ChapterDownloadService } from './chapter-download.service';
import { QidianChapterSource } from './qidian-chapter-source';
import { AuthModule } from '../auth/auth.module';
import { BookSourceJobRepository } from './book-source-job.repository';
import { BookSourceJobService } from './book-source-job.service';
import { BookSourceWorker } from './book-source-worker.service';
import { Module } from '@nestjs/common';
import { LibraryModule } from '../library/library.module';
import { UploadModule } from '../upload/upload.module';
import { TomatoRuntimeService } from './tomato-runtime.service';
import { BookSourceService } from './book-source.service';
import { BookSourceController } from './book-source.controller';

@Module({
  imports: [LibraryModule, UploadModule, AuthModule],
  controllers: [BookSourceController, ChapterRulesController],
  providers: [
    ChapterRuleRegistry,
    ChapterDownloadService,
    QidianChapterSource,
    TomatoRuntimeService,
    BookSourceService,
    BookSourceJobRepository,
    BookSourceJobService,
    BookSourceWorker,
  ],
  exports: [TomatoRuntimeService],
})
export class BookSourceModule {}
