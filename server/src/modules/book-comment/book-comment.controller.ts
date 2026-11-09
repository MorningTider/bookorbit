import { Permission } from '@bookorbit/types';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { BookCommentService } from './book-comment.service';
import { BookCommentQueryDto, CreateBookCommentDto } from './dto/book-comment.dto';

@Controller('books/:bookId/comments')
export class BookCommentController {
  constructor(private readonly comments: BookCommentService) {}
  @Get()
  list(@Param('bookId', ParseIntPipe) bookId: number, @CurrentUser() user: RequestUser, @Query() query: BookCommentQueryDto) {
    return this.comments.list(bookId, user, query);
  }
  @Post()
  create(@Param('bookId', ParseIntPipe) bookId: number, @CurrentUser() user: RequestUser, @Body() dto: CreateBookCommentDto) {
    return this.comments.create(bookId, user, dto);
  }
  @Delete(':id/moderate')
  @RequirePermission(Permission.ManageUsers)
  @HttpCode(204)
  remove(@Param('bookId', ParseIntPipe) bookId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.comments.remove(bookId, id, user);
  }
  @Delete(':id/own')
  @HttpCode(204)
  removeOwn(@Param('bookId', ParseIntPipe) bookId: number, @Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    return this.comments.remove(bookId, id, user, true);
  }
}
