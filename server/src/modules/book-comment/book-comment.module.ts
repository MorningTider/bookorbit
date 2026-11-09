import { Module } from '@nestjs/common';
import { BookModule } from '../book/book.module';
import { BookCommentController } from './book-comment.controller';
import { BookCommentService } from './book-comment.service';

@Module({ imports: [BookModule], controllers: [BookCommentController], providers: [BookCommentService] })
export class BookCommentModule {}
