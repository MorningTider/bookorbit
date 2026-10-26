import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TXT_READER_CACHE_DIRECTORY, TxtReaderCacheService } from './txt-reader-cache.service';
import { Module } from '@nestjs/common';

import { BookModule } from '../../book/book.module';
import { LibraryModule } from '../../library/library.module';
import { EpubController } from './epub.controller';
import { EpubService } from './epub.service';

@Module({
  imports: [BookModule, LibraryModule],
  controllers: [EpubController],
  providers: [EpubService, TxtReaderCacheService, { provide: TXT_READER_CACHE_DIRECTORY, useFactory: () => join(tmpdir(), 'bookorbit-txt-reader') }],
  exports: [EpubService],
})
export class EpubModule {}
