import { Body, Controller, Get, Param, ParseIntPipe, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { Permission } from '@bookorbit/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { CheckImportCandidatesDto, ImportFilesPageDto, ImportPolicyDto, LibraryImportPolicyDto } from './dto/import-review.dto';
import { ImportPolicyService } from './import-policy.service';
import { ImportReviewService } from './import-review.service';
@Controller('imports')
export class ImportReviewController {
  constructor(
    private readonly policy: ImportPolicyService,
    private readonly reviews: ImportReviewService,
  ) {}
  @Get('policy')
  @RequirePermission(Permission.ManageAppSettings)
  globalPolicy() {
    return this.policy.global();
  }
  @Put('policy')
  @RequirePermission(Permission.ManageAppSettings)
  setGlobal(@Body() dto: ImportPolicyDto) {
    return this.policy.setGlobal(dto);
  }
  @Get('libraries/:id/policy')
  @RequirePermission(Permission.ManageLibraries)
  libraryPolicy(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.policy.forLibrary(id, user);
  }
  @Put('libraries/:id/policy')
  @RequirePermission(Permission.ManageLibraries)
  setLibrary(@Param('id', ParseIntPipe) id: number, @Body() dto: LibraryImportPolicyDto, @CurrentUser() user: RequestUser) {
    return this.policy.setLibrary(id, dto.override, user);
  }
  @Post('check')
  @RequirePermission(Permission.LibraryUpload)
  check(@Body() dto: CheckImportCandidatesDto, @CurrentUser() user: RequestUser) {
    return this.reviews.checkCandidates(dto.libraryId, dto.candidates, user);
  }
  @Get('reviews')
  @RequirePermission(Permission.LibraryUpload)
  list(@CurrentUser() user: RequestUser) {
    return this.reviews.list(user);
  }
  @Get('reviews/:id')
  @RequirePermission(Permission.LibraryUpload)
  review(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.reviews.response(id, user);
  }
  @Get('books/:id/files')
  @RequirePermission(Permission.LibraryUpload)
  files(@Param('id', ParseIntPipe) id: number, @Query() query: ImportFilesPageDto, @CurrentUser() user: RequestUser) {
    return this.reviews.filesPage(id, query.cursor, query.format, user);
  }
  @Get('files/:id/version')
  @RequirePermission(Permission.LibraryUpload)
  fileVersion(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.reviews.fileVersion(id, user);
  }
}
