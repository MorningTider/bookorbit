import { Module } from '@nestjs/common';
import { AppSettingsModule } from '../app-settings/app-settings.module';
import { LibraryModule } from '../library/library.module';
import { MetadataModule } from '../metadata/metadata.module';
import { PathModule } from '../path/path.module';
import { ImportPolicyService } from './import-policy.service';
import { ImportReviewRepository } from './import-review.repository';
import { ImportReviewService } from './import-review.service';
import { ImportReviewController } from './import-review.controller';
@Module({
  imports: [AppSettingsModule, LibraryModule, MetadataModule, PathModule],
  controllers: [ImportReviewController],
  providers: [ImportPolicyService, ImportReviewRepository, ImportReviewService],
  exports: [ImportPolicyService, ImportReviewService],
})
export class ImportReviewModule {}
