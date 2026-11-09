import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, desc, eq, isNull, lt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Permission, type BookComment, type BookCommentPage } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { DB } from '../../db';
import * as schema from '../../db/schema';
import { bookComments, users } from '../../db/schema';
import { BookService } from '../book/book.service';
import { BookCommentQueryDto, CreateBookCommentDto } from './dto/book-comment.dto';

@Injectable()
export class BookCommentService {
  private readonly logger = new Logger(BookCommentService.name);
  constructor(
    @Inject(DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly books: BookService,
  ) {}

  private anchor(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private async find(bookId: number, id: number) {
    const [row] = await this.db
      .select()
      .from(bookComments)
      .where(and(eq(bookComments.bookId, bookId), eq(bookComments.id, id)))
      .limit(1);
    if (!row) throw new NotFoundException('Comment not found');
    return row;
  }

  private async verifyFile(bookId: number, fileId: number, user: RequestUser) {
    const file = await this.books.verifyFileAccess(fileId, user);
    if (file.bookId !== bookId) throw new BadRequestException('Comment file must belong to this book');
  }

  private canDelete(row: typeof bookComments.$inferSelect, user: RequestUser): boolean {
    return row.userId === user.id || user.isSuperuser || user.permissions.includes(Permission.ManageUsers);
  }

  private response(row: typeof bookComments.$inferSelect, authorName: string, user: RequestUser): BookComment {
    return {
      id: row.id,
      bookId: row.bookId,
      userId: row.userId,
      authorName,
      parentId: row.parentId,
      threadId: row.threadId,
      scope: row.scope,
      bookFileId: row.bookFileId,
      chapterHref: row.chapterHref,
      chapterTitle: row.chapterTitle,
      cfi: row.cfi,
      quote: row.quote,
      body: row.deletedAt ? '' : row.body,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      deleted: row.deletedAt !== null,
      canDelete: this.canDelete(row, user),
      deleteMode: row.userId === user.id ? 'own' : this.canDelete(row, user) ? 'moderate' : null,
    };
  }

  async list(bookId: number, user: RequestUser, query: BookCommentQueryDto): Promise<BookCommentPage> {
    await this.books.verifyBookAccess(bookId, user);
    if (query.bookFileId != null) await this.verifyFile(bookId, query.bookFileId, user);
    if (query.threadId != null) {
      const root = await this.find(bookId, query.threadId);
      if (root.threadId !== null) throw new BadRequestException('Expected a root comment');
    }
    if ((query.chapterHref || query.cfi) && !query.bookFileId) throw new BadRequestException('An anchor needs a file');
    const limit = query.limit ?? 20;
    const rows = await this.db
      .select({ comment: bookComments, authorName: users.name })
      .from(bookComments)
      .innerJoin(users, eq(users.id, bookComments.userId))
      .where(
        and(
          eq(bookComments.bookId, bookId),
          query.threadId ? eq(bookComments.threadId, query.threadId) : isNull(bookComments.threadId),
          query.before ? lt(bookComments.id, query.before) : undefined,
          query.scope ? eq(bookComments.scope, query.scope) : undefined,
          query.bookFileId ? eq(bookComments.bookFileId, query.bookFileId) : undefined,
          query.cfi
            ? eq(bookComments.anchorKey, this.anchor(query.cfi))
            : query.chapterHref
              ? eq(bookComments.anchorKey, this.anchor(query.chapterHref))
              : undefined,
        ),
      )
      .orderBy(desc(bookComments.id))
      .limit(limit + 1);
    const items = rows.slice(0, limit).map((row) => this.response(row.comment, row.authorName, user));
    return { items, nextCursor: rows.length > limit ? items[items.length - 1].id : null };
  }

  async create(bookId: number, user: RequestUser, dto: CreateBookCommentDto): Promise<BookComment> {
    await this.books.verifyBookAccess(bookId, user);
    const body = dto.body.trim();
    if (!body) throw new BadRequestException('Comment body is empty');
    let target: Pick<
      typeof bookComments.$inferInsert,
      'parentId' | 'threadId' | 'scope' | 'bookFileId' | 'anchorKey' | 'chapterHref' | 'chapterTitle' | 'cfi' | 'quote'
    >;
    if (dto.parentId != null) {
      const parent = await this.find(bookId, dto.parentId);
      if (parent.deletedAt) throw new ConflictException('Cannot reply to a deleted comment');
      target = {
        parentId: parent.id,
        threadId: parent.threadId ?? parent.id,
        scope: parent.scope,
        bookFileId: parent.bookFileId,
        anchorKey: parent.anchorKey,
        chapterHref: parent.chapterHref,
        chapterTitle: parent.chapterTitle,
        cfi: parent.cfi,
        quote: parent.quote,
      };
    } else {
      const scope = dto.scope ?? 'review';
      if (scope !== 'review' && !dto.bookFileId) throw new BadRequestException('Chapter and paragraph comments need a file');
      if (scope === 'chapter' && !dto.chapterHref?.trim()) throw new BadRequestException('A chapter comment needs a chapter');
      if (scope === 'paragraph' && (!dto.cfi?.startsWith('epubcfi(') || !dto.quote?.trim()))
        throw new BadRequestException('A paragraph comment needs a selection');
      if (dto.bookFileId != null) await this.verifyFile(bookId, dto.bookFileId, user);
      target = {
        scope,
        bookFileId: scope === 'review' ? null : dto.bookFileId,
        anchorKey: this.anchor(scope === 'review' ? 'review' : scope === 'chapter' ? dto.chapterHref! : dto.cfi!),
        chapterHref: scope === 'review' ? null : (dto.chapterHref ?? null),
        chapterTitle: scope === 'review' ? null : (dto.chapterTitle ?? null),
        cfi: scope === 'paragraph' ? dto.cfi : null,
        quote: scope === 'paragraph' ? dto.quote : null,
      };
    }
    const [inserted] = await this.db
      .insert(bookComments)
      .values({ ...target, bookId, userId: user.id, clientId: dto.clientId, body })
      .onConflictDoNothing({ target: [bookComments.userId, bookComments.clientId] })
      .returning();
    if (inserted) return this.response(inserted, user.name, user);
    const [existing] = await this.db
      .select()
      .from(bookComments)
      .where(and(eq(bookComments.userId, user.id), eq(bookComments.clientId, dto.clientId)))
      .limit(1);
    if (
      !existing ||
      existing.bookId !== bookId ||
      existing.parentId !== (dto.parentId ?? null) ||
      existing.body !== body ||
      existing.scope !== target.scope ||
      existing.bookFileId !== (target.bookFileId ?? null) ||
      existing.anchorKey !== target.anchorKey
    )
      throw new ConflictException('Client id already belongs to another comment');
    return this.response(existing, user.name, user);
  }

  async remove(bookId: number, id: number, user: RequestUser, ownOnly = false): Promise<void> {
    await this.books.verifyBookAccess(bookId, user);
    const row = await this.find(bookId, id);
    if ((ownOnly && row.userId !== user.id) || !this.canDelete(row, user))
      throw new ForbiddenException('Only the author or a moderator can delete this comment');
    const started = Date.now();
    this.logger.log(`[book.comment_delete] [start] bookId=${bookId} commentId=${id} userId=${user.id} - comment deletion started`);
    await this.db
      .update(bookComments)
      .set({ body: '', deletedAt: new Date() })
      .where(and(eq(bookComments.id, id), eq(bookComments.bookId, bookId)));
    this.logger.log(
      `[book.comment_delete] [end] bookId=${bookId} commentId=${id} userId=${user.id} durationMs=${Date.now() - started} deleted=true - comment deleted`,
    );
  }
}
