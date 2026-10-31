import { Body, Controller, Delete, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Permission } from '@bookorbit/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { ImportResolutionDto } from '../import-review/dto/import-review.dto';
import { ImportReviewService } from '../import-review/import-review.service';
import { UploadService } from './upload.service';
@Controller('imports/reviews')
@RequirePermission(Permission.LibraryUpload)
export class ImportResolutionController {
  constructor(
    private readonly upload: UploadService,
    private readonly reviews: ImportReviewService,
  ) {}
  @Post(':id/resolve')
  resolve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ImportResolutionDto, @CurrentUser() user: RequestUser) {
    return this.upload.resolveImportReview(id, dto, user);
  }
  @Delete(':id')
  discard(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.reviews.discard(id, user);
  }
}
