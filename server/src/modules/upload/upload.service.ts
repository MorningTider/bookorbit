import { parseAudioDuration } from '../metadata/extractors/audio.extractor';
import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import type { ImportIdentity, ImportOrigin, ImportResolution } from '@bookorbit/types';
import { ImportReviewRequiredException, ImportReviewService } from '../import-review/import-review.service';
import { ImportResolutionDto } from '../import-review/dto/import-review.dto';
import { ImportFileCommitService } from './import-file-commit.service';
import { fullFileSha256 } from '../import-review/import-match.utils';
import { SelfWriteRegistry } from '../../common/services/self-write-registry.service';
import { repairConvertedEdition } from './repair-converted-edition';
import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { access as fsAccess, readFile, stat, mkdtemp, rm } from 'fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'path';
import { Readable } from 'stream';
import { createReadStream } from 'fs';
import { tmpdir } from 'os';
import type { ConvertTxtDto } from './dto/convert-txt.dto';
import { and, asc, eq } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { splitMetadataIsbn } from '../../common/text-match/isbn-normalize';
import { buildPatternTokens, patternReferencesToken } from '../../common/utils/pattern-tokens.utils';
import { selectPrimaryFileKeepingCurrent } from '../../common/utils/primary-file-selection.utils';

import { DB } from '../../db';
import { realignAudioTrackOrder } from '../../db/audio-track-order';
import * as schema from '../../db/schema';
import { books, bookFiles, libraries, libraryFolders } from '../../db/schema';
import { FileLockService, bookOperationLockKey } from '../../common/services/file-lock.service';
import type { RequestUser } from '../../common/types/request-user';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { LibraryService } from '../library/library.service';
import { UploadValidatorService } from './upload-validator.service';
import { UploadStorageService } from './upload-storage.service';
import { UploadProcessorService } from './upload-processor.service';
import { FileRenameService } from '../file-write/file-rename.service';
import { isAudioFormat, resolveUploadPath } from '@bookorbit/types';
import type { AddBookFileResult, UploadResult } from '@bookorbit/types';
import { BookCoverStore } from '../book-cover-store/book-cover-store.service';
import { extractEpubMetadata } from '../metadata/lib/epub';
import { extractCbzMetadata, extractCbrMetadata, extractCb7Metadata } from '../metadata/lib/cbz-metadata';
import { parseMobiFile } from '../metadata/lib/mobi-parser';
import { parsePdfFile, type PdfParseWarning } from '../metadata/lib/pdf-parser';
import { extractAudioMetadata } from '../metadata/extractors/audio.extractor';
import { computeFileHash } from '../scanner/lib/hash';
import { resolveExistingPathSpelling } from '../../common/utils/path-identity.utils';
import { resolveSingleFileBookPath } from '../../common/utils/book-path.utils';
import { inspectEpubMediaOverlayFields, mediaOverlayCapabilityFromFields } from '../reader/epub/epub-media-overlay-capability';
import { PathPolicyService } from '../path/path-policy.service';
import { FORMATS_WITH_UNBOUNDED_METADATA_READS, MAX_BUFFERED_METADATA_BYTES } from '../../common/constants/upload.constants';
import { UploadDestinationExistsError } from './upload-storage.service';
import { uploadError } from './upload-errors';
import { convertTxtToEpub } from '../metadata/lib/txt-to-epub';

type Db = NodePgDatabase<typeof schema>;
type StoredUploadResult = UploadResult & { absolutePath: string; created: boolean; libraryId: number; preserveMetadata?: boolean };
interface UploadImportOptions {
  resolution?: ImportResolution;
  origin?: ImportOrigin;
  reviewId?: string;
  destinationBookId?: number;
}

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly appSettings: AppSettingsService,
    private readonly libraryService: LibraryService,
    private readonly validator: UploadValidatorService,
    private readonly storage: UploadStorageService,
    private readonly processor: UploadProcessorService,
    private readonly moduleRef: ModuleRef,
    private readonly pathPolicy: PathPolicyService,
    private readonly selfWriteRegistry: SelfWriteRegistry,
    private readonly importReview: ImportReviewService,
    private readonly importCommit: ImportFileCommitService,
    private readonly fileLocks: FileLockService,
    @Optional() private readonly coverStore?: BookCoverStore,
  ) {}

  private resolveFileRenameService(): FileRenameService | null {
    try {
      return this.moduleRef.get(FileRenameService, { strict: false });
    } catch {
      return null;
    }
  }

  private async inspectMediaOverlayFields(absolutePath: string, format: string | null) {
    return inspectEpubMediaOverlayFields(absolutePath, format, (err) => {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.warn(
        `[upload.media_overlay_capability] [fail] path="${sanitizeLogValue(absolutePath)}" errorClass=${error.constructor.name} error="${sanitizeLogValue(error.message)}" - EPUB media-overlay inspection failed`,
      );
    });
  }

  async upload(
    libraryId: number,
    folderId: number | undefined,
    rawFilename: string,
    fileStream: Readable,
    user: RequestUser,
    options?: UploadImportOptions,
  ): Promise<UploadResult> {
    const stored = await this.storeUpload(libraryId, folderId, rawFilename, fileStream, user, undefined, options);
    if (stored.created) {
      this.processor.processNewBookImportAsync(stored.bookId, stored.libraryId, stored.absolutePath, stored.format);
    } else if (!stored.preserveMetadata) {
      this.processor.extractMetadataAsync(stored.bookId, stored.absolutePath, stored.format);
    }
    return { bookId: stored.bookId, filename: stored.filename, format: stored.format, sizeBytes: stored.sizeBytes };
  }

  async resolveImportReview(id: string, dto: ImportResolutionDto, user: RequestUser): Promise<UploadResult> {
    return this.importReview.exclusive(id, user, () => this.resolveLockedImportReview(id, dto, user));
  }

  private async resolveLockedImportReview(id: string, dto: ImportResolutionDto, user: RequestUser): Promise<UploadResult> {
    const resolution = this.parseImportResolution(dto);
    const row = await this.importReview.claim(id, user);
    if (row.status === 'completed' && row.resultBookId) {
      await this.importReview.finish(id, user, row.resultBookId);
      return { bookId: row.resultBookId, filename: row.filename, format: row.format, sizeBytes: row.sizeBytes };
    }
    try {
      const result = await this.upload(row.libraryId, row.folderId ?? undefined, row.filename, createReadStream(row.stagingPath), user, {
        resolution,
        ...(row.origin ? { origin: row.origin } : {}),
        reviewId: id,
        destinationBookId: row.destinationBookId ?? undefined,
      });
      await this.importReview.finish(id, user, result.bookId);
      return result;
    } catch (error) {
      const current = await this.importReview.get(id, user);
      if (current.resultBookId && current.status === 'completed') {
        await this.importReview.finish(id, user, current.resultBookId);
        return { bookId: current.resultBookId, filename: current.filename, format: current.format, sizeBytes: current.sizeBytes };
      }
      await this.importReview.release(id, user);
      throw error;
    }
  }

  private parseImportResolution(dto: ImportResolutionDto): ImportResolution {
    if (dto.action === 'new' && dto.bookId === undefined && dto.fileId === undefined && dto.expectedSha256 === undefined) return { action: 'new' };
    if (dto.action === 'attach' && dto.bookId && dto.fileId === undefined && dto.expectedSha256 === undefined)
      return { action: 'attach', bookId: dto.bookId };
    if (dto.action === 'replace' && dto.bookId && dto.fileId && dto.expectedSha256)
      return { action: 'replace', bookId: dto.bookId, fileId: dto.fileId, expectedSha256: dto.expectedSha256 };
    throw new BadRequestException('The import action and target fields do not match');
  }

  private async storeIntoExistingBook(
    tempPath: string,
    filename: string,
    format: string,
    sizeBytes: number,
    identity: ImportIdentity,
    options: UploadImportOptions,
    libraryId: number,
    user: RequestUser,
  ): Promise<StoredUploadResult> {
    const resolution = options.resolution;
    if (!resolution || resolution.action === 'new') throw new BadRequestException('An existing-book action is required');
    await this.libraryService.verifyUserAccessLevel(user.id, libraryId, user.isSuperuser, 'editor');
    try {
      if (resolution.action === 'replace') {
        const result = await this.importCommit.replace({ ...resolution, incoming: tempPath, format, reviewId: options.reviewId }, user);
        await this.importReview.recordOrigin(result.bookId, identity);
        return result;
      }
      const result = await this.addFileToBook(resolution.bookId, filename, createReadStream(tempPath), user, {
        importReviewId: options.reviewId,
        preserveMetadata: true,
      });
      await this.importReview.recordOrigin(resolution.bookId, identity);
      return {
        bookId: resolution.bookId,
        filename: result.filename,
        format,
        sizeBytes,
        absolutePath: result.absolutePath,
        created: false,
        preserveMetadata: true,
        libraryId,
      };
    } finally {
      await this.storage.cleanup(tempPath);
    }
  }

  private readonly convertingBooks = new Set<number>();

  async convertTxtToEpub(bookId: number, user: RequestUser, options: ConvertTxtDto = {}) {
    const [owner] = await this.db.select({ libraryId: books.libraryId }).from(books).where(eq(books.id, bookId)).limit(1);
    if (!owner) throw new NotFoundException('Book not found');
    await this.libraryService.verifyUserAccessLevel(user.id, owner.libraryId, user.isSuperuser, 'editor');
    if (this.convertingBooks.has(bookId)) throw new BadRequestException('This book is already being converted');
    if (this.convertingBooks.size >= 2) throw new ServiceUnavailableException('Conversion queue is busy; retry shortly');
    this.convertingBooks.add(bookId);
    const startedAt = Date.now();
    let temporary: string | undefined;
    this.logger.log(`[book.convert_txt] [start] bookId=${bookId} userId=${user.id} - TXT conversion started`);
    try {
      const [txt] = await this.db
        .select({ path: bookFiles.absolutePath })
        .from(bookFiles)
        .where(and(eq(bookFiles.bookId, bookId), eq(bookFiles.format, 'txt')))
        .limit(1);
      if (!txt) throw new NotFoundException('No TXT file is attached to this book');
      const [existing] = await this.db
        .select({ id: bookFiles.id })
        .from(bookFiles)
        .where(and(eq(bookFiles.bookId, bookId), eq(bookFiles.format, 'epub')))
        .limit(1);
      if (existing) throw new BadRequestException('An EPUB file is already attached to this book');
      const [metadata] = await this.db
        .select({
          title: schema.bookMetadata.title,
          language: schema.bookMetadata.language,
          description: schema.bookMetadata.description,
          publisher: schema.bookMetadata.publisher,
          publishedDate: schema.bookMetadata.publishedDate,
          isbn10: schema.bookMetadata.isbn10,
          isbn13: schema.bookMetadata.isbn13,
        })
        .from(schema.bookMetadata)
        .where(eq(schema.bookMetadata.bookId, bookId))
        .limit(1);
      const authorRows = await this.db
        .select({ name: schema.authors.name })
        .from(schema.bookAuthors)
        .innerJoin(schema.authors, eq(schema.bookAuthors.authorId, schema.authors.id))
        .where(eq(schema.bookAuthors.bookId, bookId))
        .orderBy(asc(schema.bookAuthors.displayOrder));
      const title = metadata?.title || basename(txt.path, extname(txt.path));
      const filename = this.validator.sanitizeFilename(`${basename(txt.path, extname(txt.path))}.epub`);
      temporary = await mkdtemp(join(tmpdir(), 'bookorbit-convert-'));
      const output = join(temporary, filename);
      let cover: { bytes: Buffer; mediaType: 'image/jpeg' | 'image/png' } | undefined;
      try {
        const coverPath = await this.coverStore?.resolve(bookId, { medium: 'ebook', variant: 'cover' });
        if (coverPath && (await stat(coverPath)).size <= 10 * 1024 * 1024) {
          cover = {
            bytes: await readFile(coverPath),
            mediaType: extname(coverPath).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg',
          };
        }
      } catch {
        this.logger.warn(`[book.convert_txt] [end] bookId=${bookId} coverEmbedded=false - cover unavailable during TXT conversion`);
      }
      await convertTxtToEpub(txt.path, output, title, {
        ...options,
        language: metadata?.language || 'zh',
        authors: authorRows.map((row) => row.name),
        description: metadata?.description,
        publisher: metadata?.publisher,
        publishedDate: metadata?.publishedDate,
        isbn: metadata?.isbn13 || metadata?.isbn10,
        cover,
      });
      await this.libraryService.verifyUserAccessLevel(user.id, owner.libraryId, user.isSuperuser, 'editor');
      const result = await this.addFileToBook(bookId, filename, createReadStream(output), user);
      this.logger.log(
        `[book.convert_txt] [end] bookId=${bookId} durationMs=${Date.now() - startedAt} fileId=${result.id} - TXT conversion completed`,
      );
      return result;
    } catch (error) {
      this.logger.warn(
        `[book.convert_txt] [fail] bookId=${bookId} durationMs=${Date.now() - startedAt} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - TXT conversion failed`,
      );
      throw error;
    } finally {
      this.convertingBooks.delete(bookId);
      if (temporary) await rm(temporary, { recursive: true, force: true });
    }
  }

  uploadForSession(
    libraryId: number,
    folderId: number | undefined,
    rawFilename: string,
    fileStream: Readable,
    user: RequestUser,
    uploadSessionId: string,
  ): Promise<StoredUploadResult> {
    return this.storeUpload(libraryId, folderId, rawFilename, fileStream, user, uploadSessionId);
  }

  async processStoredUpload(stored: StoredUploadResult): Promise<void> {
    if (stored.created) {
      await this.processor.processNewBookImport(stored.bookId, stored.libraryId, stored.absolutePath, stored.format);
    } else if (!stored.preserveMetadata) {
      await this.processor.extractMetadata(stored.bookId, stored.absolutePath, stored.format);
    }
  }

  private async storeUpload(
    libraryId: number,
    folderId: number | undefined,
    rawFilename: string,
    fileStream: Readable,
    user: RequestUser,
    uploadSessionId?: string,
    importOptions?: UploadImportOptions,
  ): Promise<StoredUploadResult> {
    const event = 'upload.book';
    const startedAt = Date.now();
    this.logger.log(
      `[${event}] [start] libraryId=${libraryId} userId=${user.id} folderId=${folderId ?? 'auto'} rawFilename="${rawFilename}" - upload started`,
    );
    const isSuperuser = user.isSuperuser;

    const library = await this.findLibraryOrFail(libraryId);
    await this.libraryService.verifyUserAccess(user.id, libraryId, isSuperuser);

    const folder = await this.resolveFolder(libraryId, folderId);

    const filename = this.validator.sanitizeFilename(rawFilename);
    const format = this.validator.validateFormat(filename, library.allowedFormats);

    const { tempPath, sizeBytes } = await this.storage.streamToTemp(fileStream);
    if (sizeBytes === 0) {
      await this.storage.cleanup(tempPath);
      throw uploadError.empty();
    }
    let destinationPath: string | null = null;
    let selfWritePath: string | null = null;

    try {
      await this.validator.validateContent(tempPath, format);
      const identity = await this.importReview.extractIdentity(tempPath, filename, format, importOptions?.origin);
      const [matches = []] = await this.importReview.matches(
        libraryId,
        [identity],
        user,
        { path: tempPath, size: sizeBytes },
        importOptions?.destinationBookId,
      );
      if (!importOptions?.resolution && matches.length)
        await this.importReview.stage(tempPath, { libraryId, folderId: folder.id, filename, format, sizeBytes, identity }, matches, user);
      const resolution = importOptions?.resolution;
      if (resolution && resolution.action !== 'new') {
        const target = matches.find((item) => item.bookId === resolution.bookId);
        if (!target) throw new ConflictException('The selected duplicate no longer matches; review the library again');
        return await this.storeIntoExistingBook(tempPath, filename, format, sizeBytes, identity, importOptions, target.libraryId, user);
      }
      let { absolutePath, bookFolderPath } = await this.resolveDestination(library, folder.path, tempPath, filename, format);
      if (importOptions?.resolution?.action === 'new') {
        const suffix = randomUUID().slice(0, 8);
        if (library.organizationMode === 'book_per_folder') {
          bookFolderPath = join(
            resolve(bookFolderPath) === resolve(folder.path) ? folder.path : dirname(bookFolderPath),
            `${basename(bookFolderPath)} (${suffix})`,
          );
          absolutePath = join(bookFolderPath, basename(absolutePath));
        } else {
          absolutePath = join(dirname(absolutePath), `${basename(absolutePath, extname(absolutePath))} (${suffix})${extname(absolutePath)}`);
          bookFolderPath = absolutePath;
        }
      }
      await this.pathPolicy.assertWithinRoot(absolutePath, folder.path);
      destinationPath = absolutePath;

      // The file may land in a book that is already there, so it lands under that book's lock, the
      // one write-back, rename and merge take. Spelled as on disk, which is how the book row has it.
      const lockFolder = (await resolveExistingPathSpelling(bookFolderPath, folder.path)) ?? bookFolderPath;
      const { bookId, created, persistedAbsolutePath } = await this.processor.withFolderBookLock(libraryId, lockFolder, async () => {
        if (await this.destinationExists(absolutePath)) {
          const destinationBookId = await this.importReview.destinationOwner(libraryId, absolutePath, user);
          const [destinationMatches = []] = await this.importReview.matches(
            libraryId,
            [identity],
            user,
            { path: tempPath, size: sizeBytes },
            destinationBookId,
          );
          await this.importReview.stage(
            tempPath,
            { libraryId, folderId: folder.id, filename, format, sizeBytes, identity, destinationBookId },
            destinationMatches,
            user,
          );
        }

        selfWritePath = absolutePath;
        this.selfWriteRegistry.begin([selfWritePath]);
        await this.storage.moveToPath(tempPath, absolutePath);

        const persistedPath = (await resolveExistingPathSpelling(absolutePath, folder.path)) ?? absolutePath;
        const persistedBookFolderPath = bookFolderPath === absolutePath ? persistedPath : dirname(persistedPath);
        const persistedRelPath = relative(folder.path, persistedPath);
        destinationPath = persistedPath;

        const createArgs = [libraryId, folder.id, persistedBookFolderPath, persistedPath, persistedRelPath, format, sizeBytes] as const;
        const recordOptions = {
          ...(uploadSessionId ? { uploadSessionId } : {}),
          ...(importOptions?.reviewId ? { importReviewId: importOptions.reviewId } : {}),
        };
        const record = Object.keys(recordOptions).length
          ? await this.processor.createBookRecord(...createArgs, recordOptions)
          : await this.processor.createBookRecord(...createArgs);
        await this.importReview.recordOrigin(record.bookId, identity);
        return { ...record, persistedAbsolutePath: persistedPath };
      });

      this.logger.log(
        `[${event}] [end] libraryId=${libraryId} userId=${user.id} folderId=${folder.id} bookId=${bookId} format=${format} sizeBytes=${sizeBytes} durationMs=${Date.now() - startedAt} - upload completed`,
      );
      return {
        bookId,
        filename: basename(persistedAbsolutePath),
        format,
        sizeBytes,
        absolutePath: persistedAbsolutePath,
        created,
        libraryId,
      };
    } catch (caught) {
      if (caught instanceof ImportReviewRequiredException) {
        await this.storage.cleanup(tempPath);
        this.logger.log(
          `[${event}] [end] libraryId=${libraryId} userId=${user.id} folderId=${folder.id} durationMs=${Date.now() - startedAt} awaitingChoice=true - incoming file retained for user decision`,
        );
        throw caught;
      }
      let err = caught;
      if (err instanceof UploadDestinationExistsError) {
        err = uploadError.destinationConflict(
          `A file named "${destinationPath ? basename(destinationPath) : filename}" already exists at the target location`,
        );
      }
      const { errorClass, errorMessage } = this.parseError(err);
      this.logger.error(
        `[${event}] [fail] libraryId=${libraryId} userId=${user.id} folderId=${folder.id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - upload failed`,
      );
      await this.storage.cleanup(tempPath);
      throw err;
    } finally {
      if (selfWritePath) this.selfWriteRegistry.end([selfWritePath]);
    }
  }

  async repairConvertedEpub(bookId: number, user: RequestUser) {
    const startedAt = Date.now();
    this.logger.log(`[book.repair_converted_edition] [start] bookId=${bookId} userId=${user.id} - edition repair started`);
    try {
      const [book] = await this.db.select({ libraryId: books.libraryId }).from(books).where(eq(books.id, bookId)).limit(1);
      if (!book) throw new NotFoundException('Book not found');
      await this.libraryService.verifyUserAccessLevel(user.id, book.libraryId, user.isSuperuser, 'editor');
      const result = await repairConvertedEdition(this.db, bookId, book.libraryId);
      this.logger.log(
        `[book.repair_converted_edition] [end] bookId=${bookId} userId=${user.id} durationMs=${Date.now() - startedAt} fileId=${result.fileId} removedDuplicateBookId=${result.removedDuplicateBookId} - edition repair completed`,
      );
      return result;
    } catch (error) {
      this.logger.warn(
        `[book.repair_converted_edition] [fail] bookId=${bookId} userId=${user.id} durationMs=${Date.now() - startedAt} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - edition repair failed`,
      );
      throw error;
    }
  }

  async addFileToBook(
    bookId: number,
    rawFilename: string,
    fileStream: Readable,
    user: RequestUser,
    options?: { importReviewId?: string; preserveMetadata?: boolean },
  ): Promise<AddBookFileResult> {
    const event = 'book.add_file';
    const startedAt = Date.now();
    this.logger.log(
      `[${event}] [start] bookId=${bookId} userId=${user.id} rawFilename="${sanitizeLogValue(rawFilename)}" - add file to book started`,
    );

    const [bookRow] = await this.db
      .select({
        id: books.id,
        folderPath: books.folderPath,
        libraryId: books.libraryId,
        libraryFolderId: books.libraryFolderId,
        allowedFormats: libraries.allowedFormats,
        organizationMode: libraries.organizationMode,
        libraryFolderPath: libraryFolders.path,
      })
      .from(books)
      .innerJoin(libraries, eq(books.libraryId, libraries.id))
      .innerJoin(libraryFolders, eq(books.libraryFolderId, libraryFolders.id))
      .where(eq(books.id, bookId))
      .limit(1);

    if (!bookRow) throw new NotFoundException(`Book ${bookId} not found`);

    await this.libraryService.verifyUserAccess(user.id, bookRow.libraryId, user.isSuperuser);

    const filename = this.validator.sanitizeFilename(rawFilename);
    const format = this.validator.validateFormat(filename, bookRow.allowedFormats);

    const { tempPath, sizeBytes } = await this.storage.streamToTemp(fileStream);

    if (sizeBytes === 0) {
      await this.storage.cleanup(tempPath);
      throw uploadError.empty();
    }

    let destination: string | null = null;
    let shouldCleanupDestination = false;
    let selfWritePath: string | null = null;

    try {
      await this.validator.validateContent(tempPath, format);
      const fileHash = await computeFileHash(tempPath);

      // The upload streamed without the lock; the write into the folder takes it, and re-reads the
      // folder, because a merge or rename may have moved the book while the bytes arrived.
      const result = await this.fileLocks.withLock(bookOperationLockKey(bookId), async () => {
        const [current] = await this.db
          .select({
            folderPath: books.folderPath,
            libraryFolderId: books.libraryFolderId,
            libraryFolderPath: libraryFolders.path,
            libraryId: books.libraryId,
            organizationMode: libraries.organizationMode,
          })
          .from(books)
          .innerJoin(libraryFolders, eq(books.libraryFolderId, libraryFolders.id))
          .innerJoin(libraries, eq(books.libraryId, libraries.id))
          .where(eq(books.id, bookId))
          .limit(1);
        if (!current) throw new NotFoundException(`Book ${bookId} not found`);

        await this.libraryService.verifyUserAccess(user.id, current.libraryId, user.isSuperuser);
        const durationSeconds = options?.preserveMetadata && isAudioFormat(format) ? await parseAudioDuration(tempPath) : undefined;
        if (durationSeconds === null) throw new BadRequestException('Unable to measure the incoming audio file duration');

        const samePartialHash = await this.db
          .select({ id: bookFiles.id, absolutePath: bookFiles.absolutePath })
          .from(bookFiles)
          .where(and(eq(bookFiles.bookId, bookId), eq(bookFiles.fileHash, fileHash)))
          .limit(21);
        if (samePartialHash.length > 20) throw new ConflictException('Too many matching files; review the book before attaching another file');
        if (samePartialHash.length) {
          const incomingHash = await fullFileSha256(tempPath);
          for (const candidate of samePartialHash) {
            await this.pathPolicy.assertWithinRoot(candidate.absolutePath, current.libraryFolderPath);
            if ((await fullFileSha256(candidate.absolutePath)) === incomingHash)
              throw uploadError.duplicate('This file is already attached to this book');
          }
        }

        const destinationFolder = current.organizationMode === 'book_per_file' ? dirname(current.folderPath) : current.folderPath;
        destination = join(destinationFolder, filename);
        await this.pathPolicy.assertWithinRoot(destination, current.libraryFolderPath);

        if (await this.destinationExists(destination)) {
          if (!options?.preserveMetadata) throw uploadError.destinationConflict(`A file named "${filename}" already exists in this book's folder`);
          destination = join(destinationFolder, `${basename(filename, extname(filename))} (${randomUUID()})${extname(filename)}`);
          await this.pathPolicy.assertWithinRoot(destination, current.libraryFolderPath);
        }

        this.selfWriteRegistry.begin([destination]);
        selfWritePath = destination;
        shouldCleanupDestination = true;
        await this.storage.moveToPath(tempPath, destination);
        // File is on disk. Do not delete it on any subsequent failure; the scanner
        // will reconcile any orphan. This also prevents the catch block from deleting
        // a file that a concurrent upload may have written to the same path.
        shouldCleanupDestination = false;

        return this.registerBookFile({
          bookId,
          libraryFolderId: current.libraryFolderId,
          libraryFolderPath: current.libraryFolderPath,
          destination,
          sizeBytes,
          fileHash,
          format,
          durationSeconds,
          preserveMetadata: options?.preserveMetadata,
          importReview: options?.importReviewId ? { id: options.importReviewId, userId: user.id } : undefined,
        });
      });

      this.logger.log(
        `[${event}] [end] bookId=${bookId} userId=${user.id} fileId=${result.id} format=${format} sizeBytes=${sizeBytes} durationMs=${Date.now() - startedAt} - add file to book completed`,
      );

      return result;
    } catch (caught) {
      let err = caught;
      if (err instanceof UploadDestinationExistsError) {
        err = uploadError.destinationConflict(`A file named "${filename}" already exists in this book's folder`);
      }
      const errorClass = err instanceof Error ? err.name : 'Error';
      const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
      this.logger.warn(
        `[${event}] [fail] bookId=${bookId} userId=${user.id} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - add file to book failed`,
      );
      await Promise.allSettled([
        this.storage.cleanup(tempPath),
        shouldCleanupDestination && destination ? this.storage.cleanup(destination) : Promise.resolve(),
      ]);
      throw err;
    } finally {
      if (selfWritePath) this.selfWriteRegistry.end([selfWritePath]);
    }
  }

  /**
   * Records a file that is already in place inside the book folder: inserts the row, re-picks the
   * primary file and queues the same follow-ups an upload gets. Shared by uploads and by files the
   * server generates itself, which must not go through the upload size limit.
   */
  async registerBookFile(params: {
    bookId: number;
    libraryFolderId: number;
    libraryFolderPath: string;
    destination: string;
    sizeBytes: number;
    fileHash: string;
    format: string;
    durationSeconds?: number;
    preserveMetadata?: boolean;
    importReview?: { id: string; userId: number };
  }): Promise<AddBookFileResult> {
    const { bookId, libraryFolderId, libraryFolderPath, destination, sizeBytes, fileHash, format } = params;
    const fileStat = await stat(destination, { bigint: true });
    const ino = fileStat.ino;
    const relPath = relative(libraryFolderPath, destination);
    const mediaOverlayFields = await this.inspectMediaOverlayFields(destination, format);

    const { inserted, isPrimary, finalStatus } = await this.db.transaction(async (tx) => {
      const [lockedBook] = await tx
        .select({
          primaryFileId: books.primaryFileId,
          status: books.status,
          formatPriority: libraries.formatPriority,
        })
        .from(books)
        .innerJoin(libraries, eq(books.libraryId, libraries.id))
        .where(eq(books.id, bookId))
        .for('update', { of: books })
        .limit(1);

      if (!lockedBook) throw new NotFoundException(`Book ${bookId} not found`);

      const [inserted] = await tx
        .insert(bookFiles)
        .values({
          bookId,
          libraryFolderId,
          absolutePath: destination,
          relPath,
          ino,
          sizeBytes,
          mtime: fileStat.mtime,
          fileHash,
          ...(params.durationSeconds !== undefined ? { durationSeconds: params.durationSeconds } : {}),
          format,
          role: 'content',
          ...mediaOverlayFields,
        })
        .returning({
          id: bookFiles.id,
          format: bookFiles.format,
          role: bookFiles.role,
          sizeBytes: bookFiles.sizeBytes,
          absolutePath: bookFiles.absolutePath,
          createdAt: bookFiles.createdAt,
          durationSeconds: bookFiles.durationSeconds,
        });

      if (!inserted) throw new Error('Failed to insert book file record');
      // A track added by hand has no number yet, which would play it after every other track.
      if (isAudioFormat(format)) await realignAudioTrackOrder(tx, bookId);

      const contentFiles = await tx
        .select({
          id: bookFiles.id,
          format: bookFiles.format,
          sizeBytes: bookFiles.sizeBytes,
          mediaOverlayAvailable: bookFiles.mediaOverlayAvailable,
        })
        .from(bookFiles)
        .where(and(eq(bookFiles.bookId, bookId), eq(bookFiles.role, 'content')))
        .orderBy(asc(bookFiles.id));

      const winner = selectPrimaryFileKeepingCurrent(contentFiles, lockedBook.primaryFileId, lockedBook.formatPriority);
      const nextPrimaryFileId = winner?.id ?? null;
      const needsPrimaryUpdate = nextPrimaryFileId !== lockedBook.primaryFileId;
      const needsStatusUpdate = lockedBook.status === 'missing';

      if (needsPrimaryUpdate || needsStatusUpdate) {
        await tx
          .update(books)
          .set({
            ...(needsPrimaryUpdate ? { primaryFileId: nextPrimaryFileId } : {}),
            ...(needsStatusUpdate ? { status: 'present' } : {}),
            updatedAt: new Date(),
          })
          .where(eq(books.id, bookId));
      }

      if (params.importReview)
        await tx
          .update(schema.bookImportReviews)
          .set({ status: 'completed', resultBookId: bookId, updatedAt: new Date() })
          .where(and(eq(schema.bookImportReviews.id, params.importReview.id), eq(schema.bookImportReviews.userId, params.importReview.userId)));

      return {
        inserted,
        isPrimary: inserted.id === nextPrimaryFileId,
        finalStatus: needsStatusUpdate ? 'present' : lockedBook.status,
      };
    });

    if (!params.preserveMetadata) {
      this.processor.extractAudioDurationAsync(bookId, destination, format);
      this.processor.extractAddedAudioChaptersAsync(bookId, format);
      this.processor.reconcileCoversAsync([bookId]);
    }

    return {
      id: inserted.id,
      format: inserted.format,
      role: isPrimary ? 'primary' : inserted.role,
      sizeBytes: inserted.sizeBytes,
      absolutePath: inserted.absolutePath,
      createdAt: inserted.createdAt.toISOString(),
      filename: basename(destination),
      durationSeconds: inserted.durationSeconds,
      mediaOverlay: mediaOverlayCapabilityFromFields({ format: inserted.format, ...mediaOverlayFields }),
      bookStatus: finalStatus,
    };
  }

  async renameBookFiles(bookId: number, user: RequestUser): Promise<void> {
    const event = 'book.rename_files';
    const startedAt = Date.now();
    this.logger.log(`[${event}] [start] bookId=${bookId} userId=${user.id} - rename book files started`);

    const [bookRow] = await this.db.select({ id: books.id, libraryId: books.libraryId }).from(books).where(eq(books.id, bookId)).limit(1);

    if (!bookRow) throw new NotFoundException(`Book ${bookId} not found`);

    await this.libraryService.verifyUserAccessLevel(user.id, bookRow.libraryId, user.isSuperuser, 'editor');

    const fileRenameService = this.resolveFileRenameService();
    if (!fileRenameService) {
      throw new ServiceUnavailableException('File rename service is not available');
    }

    await fileRenameService.performRename(bookId, user.id, true, false);

    this.logger.log(`[${event}] [end] bookId=${bookId} userId=${user.id} durationMs=${Date.now() - startedAt} - rename book files completed`);
  }

  /**
   * Both organization modes keep the pattern's folder segments, so an upload lands where the
   * rename and move services would put the same book. The modes differ only in what counts as
   * the book: in `book_per_file` the file itself is the book key, not the folder holding it.
   */
  private async resolveDestination(
    library: { name?: string | null; fileNamingPattern?: string | null; organizationMode?: string | null },
    libraryFolderPath: string,
    tempPath: string,
    filename: string,
    format: string,
  ): Promise<{ absolutePath: string; bookFolderPath: string }> {
    const pattern =
      library.fileNamingPattern ??
      (library.organizationMode === 'book_per_folder'
        ? await this.appSettings.getUploadPatternBookPerFolder()
        : await this.appSettings.getUploadPattern());
    const sanitizeForCrossPlatform = await this.appSettings.isCrossPlatformPathSanitizationEnabled();
    const isBookPerFile = library.organizationMode === 'book_per_file';

    if (pattern) {
      const stem = basename(filename, extname(filename));
      const mediaOverlayAvailable = patternReferencesToken(pattern, 'readaloud')
        ? (await this.inspectMediaOverlayFields(tempPath, format)).mediaOverlayAvailable
        : false;
      const tokens = await this.buildUploadPatternTokens(tempPath, format, stem, library.name, mediaOverlayAvailable);
      const resolved = resolveUploadPath(pattern, tokens, format, { sanitizeForCrossPlatform });

      if (resolved) {
        const absolutePath = join(libraryFolderPath, resolved);
        return { absolutePath, bookFolderPath: resolveSingleFileBookPath(absolutePath, libraryFolderPath, library.organizationMode) };
      }
    }

    if (isBookPerFile) {
      const absolutePath = join(libraryFolderPath, filename);
      return { absolutePath, bookFolderPath: absolutePath };
    }

    const stem = basename(filename, extname(filename));
    const bookFolderPath = join(libraryFolderPath, stem);
    return { absolutePath: join(bookFolderPath, filename), bookFolderPath };
  }

  private async buildUploadPatternTokens(
    tempPath: string,
    format: string,
    stem: string,
    libraryName?: string | null,
    mediaOverlayAvailable = false,
  ): Promise<Record<string, string>> {
    const fallback = buildPatternTokens({ metadata: {}, originalStem: stem, format, libraryName, mediaOverlayAvailable });
    const event = 'upload.pattern_tokens';
    const startedAt = Date.now();

    try {
      const fileSize = (await stat(tempPath)).size;
      if (FORMATS_WITH_UNBOUNDED_METADATA_READS.has(format) && fileSize > MAX_BUFFERED_METADATA_BYTES) return fallback;
      let parsed: {
        title?: string | null;
        subtitle?: string | null;
        publisher?: string | null;
        publishedYear?: number | null;
        language?: string | null;
        seriesName?: string | null;
        seriesIndex?: string | null;
        isbn13?: string | null;
        isbn10?: string | null;
        authors: { name: string }[];
        narrators?: string[];
      } | null = null;

      if (format === 'epub') {
        parsed = await extractEpubMetadata(tempPath);
      } else if (format === 'cbz') {
        parsed = await extractCbzMetadata(tempPath);
      } else if (format === 'cbr') {
        parsed = await extractCbrMetadata(tempPath);
      } else if (format === 'cb7') {
        parsed = await extractCb7Metadata(tempPath);
      } else if (format === 'mobi' || format === 'azw3' || format === 'azw') {
        const mobi = await parseMobiFile(tempPath);
        if (mobi) {
          const year = mobi.publishedDate ? parseInt(mobi.publishedDate.substring(0, 4), 10) || null : null;
          parsed = {
            title: mobi.title,
            publisher: mobi.publisher,
            publishedYear: year,
            language: mobi.language,
            ...splitMetadataIsbn(mobi.isbn),
            seriesName: null,
            seriesIndex: null,
            authors: mobi.authors.map((name) => ({ name })),
          };
        }
      } else if (format === 'pdf') {
        const pdf = await parsePdfFile(tempPath, {
          extractCover: false,
          onWarning: (warning) => this.logPdfPatternTokenWarning(warning),
        });
        if (pdf) {
          parsed = { title: pdf.title, publisher: pdf.publisher, authors: pdf.authors, seriesName: null, seriesIndex: null };
        }
      } else if (isAudioFormat(format)) {
        parsed = await extractAudioMetadata(tempPath);
      }

      if (!parsed) return fallback;

      return buildPatternTokens({
        metadata: parsed,
        authors: parsed.authors.map((author) => author.name),
        narrators: parsed.narrators,
        originalStem: stem,
        format,
        libraryName,
        mediaOverlayAvailable,
      });
    } catch (err) {
      const { errorClass, errorMessage } = this.parseError(err);
      this.logger.warn(
        `[${event}] [fail] format=${format} durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${errorMessage}" - token extraction failed, using filename tokens`,
      );
    }

    return fallback;
  }

  private parseError(err: unknown): { errorClass: string; errorMessage: string } {
    const errorClass = err instanceof Error ? err.name : 'Error';
    const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : String(err));
    return { errorClass, errorMessage };
  }

  private logPdfPatternTokenWarning(warning: PdfParseWarning): void {
    if (warning.code === 'buffered-large-pdf') {
      this.logger.warn(
        `[upload.pattern_tokens_pdf] [end] path="${warning.absolutePath}" code=${warning.code} sizeBytes=${warning.sizeBytes ?? 0} thresholdBytes=${warning.thresholdBytes ?? 0} - large pdf buffered in memory`,
      );
      return;
    }
    this.logger.warn(
      `[upload.pattern_tokens_pdf] [fail] path="${warning.absolutePath}" code=${warning.code} errorClass=${warning.errorClass} error="${warning.errorMessage}" - pdf token extraction warning emitted`,
    );
  }

  private async destinationExists(absolutePath: string): Promise<boolean> {
    try {
      await fsAccess(absolutePath);
      return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return false;
      }
      throw err;
    }
  }

  private async findLibraryOrFail(libraryId: number) {
    const [library] = await this.db.select().from(libraries).where(eq(libraries.id, libraryId)).limit(1);
    if (!library) throw new NotFoundException('Library not found');
    return library;
  }

  private async resolveFolder(libraryId: number, folderId?: number) {
    if (folderId !== undefined) {
      const [folder] = await this.db.select().from(libraryFolders).where(eq(libraryFolders.id, folderId)).limit(1);
      if (!folder || folder.libraryId !== libraryId) throw new BadRequestException('Folder does not belong to this library');
      return folder;
    }

    const folders = await this.db.select().from(libraryFolders).where(eq(libraryFolders.libraryId, libraryId));
    if (folders.length === 0) throw new BadRequestException('Library has no folders configured');
    return folders.toSorted((a, b) => a.id - b.id)[0];
  }
}
