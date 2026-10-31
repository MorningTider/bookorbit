import { ImportFileCommitService } from './import-file-commit.service';
import { ImportReviewModule } from '../import-review/import-review.module';
import { ImportResolutionController } from './import-resolution.controller';
import { SelfWriteRegistryModule } from '../../common/self-write-registry.module';
import { Module } from '@nestjs/common';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { BookCoverStoreModule } from '../book-cover-store/book-cover-store.module';
import { BookMetadataFetchModule } from '../book-metadata-fetch/book-metadata-fetch.module';
import { FileWriteModule } from '../file-write/file-write.module';
import { LibraryModule } from '../library/library.module';
import { MetadataModule } from '../metadata/metadata.module';
import { PathModule } from '../path/path.module';
import { ScannerModule } from '../scanner/scanner.module';
import { BookFileUploadController } from './book-file-upload.controller';
import { UploadController } from './upload.controller';
import { UploadProcessorService } from './upload-processor.service';
import { UploadService } from './upload.service';
import { UploadStorageService } from './upload-storage.service';
import { UploadValidatorService } from './upload-validator.service';
import { UploadSessionController } from './upload-session.controller';
import { UploadSessionRepository } from './upload-session.repository';
import { UploadSessionService } from './upload-session.service';

@Module({
  imports: [
    ImportReviewModule,
    SelfWriteRegistryModule,
    AppSettingsModule,
    BookCoverStoreModule,
    LibraryModule,
    MetadataModule,
    BookMetadataFetchModule,
    FileWriteModule,
    PathModule,
    ScannerModule,
  ],
  controllers: [UploadController, BookFileUploadController, UploadSessionController, ImportResolutionController],
  providers: [
    ImportFileCommitService,
    UploadService,
    UploadValidatorService,
    UploadStorageService,
    UploadProcessorService,
    UploadSessionRepository,
    UploadSessionService,
  ],
  exports: [ImportFileCommitService, UploadValidatorService, UploadStorageService, UploadProcessorService, UploadService],
})
export class UploadModule {}
