import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import { AuditAction, AuditResource, Permission } from '@bookorbit/types';
import { Auditable } from '../../common/decorators/auditable.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { OrganizeEpubTocDto } from './epub-toc.dto';
import { EpubTocService } from './epub-toc.service';

@Controller('books/:bookId/files/:fileId/toc')
@RequirePermission(Permission.LibraryEditMetadata)
export class EpubTocController {
  constructor(private readonly toc: EpubTocService) {}
  @Get()
  inspect(@Param('bookId', ParseIntPipe) bookId: number, @Param('fileId', ParseIntPipe) fileId: number, @CurrentUser() user: RequestUser) {
    return this.toc.inspect(bookId, fileId, user);
  }
  @Post('organize')
  @HttpCode(200)
  @Auditable({
    action: AuditAction.BookWriteAndRename,
    resource: AuditResource.Book,
    getResourceId: (req) => Number(req.params['bookId']),
    description: (req) => `Organized EPUB directory for book #${req.params['bookId']}`,
  })
  organize(
    @Param('bookId', ParseIntPipe) bookId: number,
    @Param('fileId', ParseIntPipe) fileId: number,
    @Body() input: OrganizeEpubTocDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.toc.organize(bookId, fileId, input, user);
  }
}
