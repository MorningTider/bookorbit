import { RetrySourceJobDto } from './dto/retry-source-job.dto';
import { AcquireRuleChaptersDto } from './dto/public-chapter-rules.dto';
import { AcquireQidianDto } from './dto/acquire-qidian.dto';
import { Controller, Delete, Get, Param, ParseIntPipe, Post, Body, Query, HttpCode } from '@nestjs/common';
import { Permission } from '@bookorbit/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RequireLibraryType } from '../../common/decorators/require-library-type.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { BookSourceService } from './book-source.service';
import { BookSourceJobService } from './book-source-job.service';
import { AcquireTomatoDto } from './dto/acquire-tomato.dto';
import { ListSourceJobsDto } from './dto/list-source-jobs.dto';

@Controller()
@RequirePermission(Permission.LibraryUpload, Permission.BookRequestSelfFulfill)
export class BookSourceController {
  constructor(
    private readonly sources: BookSourceService,
    private readonly jobs: BookSourceJobService,
  ) {}

  @Get('book-sources/status')
  status() {
    return this.sources.status();
  }

  @Post('libraries/:id/sources/fanqie')
  @HttpCode(202)
  @RequireLibraryType('books')
  acquire(@Param('id', ParseIntPipe) id: number, @Body() dto: AcquireTomatoDto, @CurrentUser() user: RequestUser) {
    return dto.importResolution
      ? this.jobs.enqueue(id, dto.folderId, dto.bookId, user, dto.importResolution)
      : this.jobs.enqueue(id, dto.folderId, dto.bookId, user);
  }

  @Post('libraries/:id/sources/qidian')
  @HttpCode(202)
  @RequireLibraryType('books')
  acquireQidian(@Param('id', ParseIntPipe) id: number, @Body() dto: AcquireQidianDto, @CurrentUser() user: RequestUser) {
    return dto.importResolution
      ? this.jobs.enqueueQidian(id, dto.folderId, dto.bookId, user, dto.importResolution)
      : this.jobs.enqueueQidian(id, dto.folderId, dto.bookId, user);
  }

  @Get('book-sources/chapter-sources')
  chapterSources() {
    return this.sources.chapterSources();
  }

  @Post('libraries/:id/sources/chapters')
  @HttpCode(202)
  @RequireLibraryType('books')
  acquireRule(@Param('id', ParseIntPipe) id: number, @Body() dto: AcquireRuleChaptersDto, @CurrentUser() user: RequestUser) {
    return this.jobs.enqueueRule(id, dto.folderId, dto.source, dto.bookId, user);
  }

  @Get('book-sources/jobs')
  list(@Query() query: ListSourceJobsDto, @CurrentUser() user: RequestUser) {
    return this.jobs.list(user, query.cursor);
  }

  @Get('book-sources/jobs/:id')
  get(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.jobs.get(id, user);
  }

  @Delete('book-sources/jobs/:id')
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.jobs.remove(id, user);
  }

  @Post('book-sources/jobs/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.jobs.cancel(id, user);
  }

  @Post('book-sources/jobs/:id/retry')
  @HttpCode(202)
  retry(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser, @Body() dto: RetrySourceJobDto = {}) {
    return dto.confirmedImportNotCompleted ? this.jobs.retry(id, user, true) : this.jobs.retry(id, user);
  }
}
