import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { basename, extname, join } from 'node:path';
import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, rm } from 'node:fs/promises';
import type {
  ImportCandidateCheck,
  ImportDuplicateMatch,
  ImportDuplicateReason,
  ImportIdentity,
  ImportOrigin,
  ImportReviewResponse,
} from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { LibraryService } from '../library/library.service';
import { MetadataExtractionService } from '../metadata/metadata-extraction.service';
import { PathPolicyService } from '../path/path-policy.service';
import { FORMATS_WITH_UNBOUNDED_METADATA_READS, MAX_BUFFERED_METADATA_BYTES } from '../../common/constants/upload.constants';
import { computeFileHash } from '../../common/utils/file-hash.utils';
import { ImportPolicyService } from './import-policy.service';
import { ImportReviewRepository } from './import-review.repository';
import { fullFileSha256, importIsbn, importMediaKind, matchingImportAuthors, normalizeImportText } from './import-match.utils';

export class ImportReviewRequiredException extends ConflictException {
  constructor(readonly review: ImportReviewResponse) {
    super({ message: 'Duplicate import needs your decision', errorCode: 'IMPORT_REVIEW_REQUIRED', errorMeta: { reviewId: review.id } });
  }
}
@Injectable()
export class ImportReviewService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ImportReviewService.name);
  private legacyCursor = 0;
  private activeCommits = 0;
  private readonly directory: string;
  constructor(
    private readonly policy: ImportPolicyService,
    private readonly repository: ImportReviewRepository,
    private readonly libraries: LibraryService,
    private readonly extraction: MetadataExtractionService,
    private readonly paths: PathPolicyService,
    config: ConfigService,
  ) {
    this.directory = join(config.getOrThrow<string>('storage.appDataPath'), 'import-reviews');
  }

  async onApplicationBootstrap() {
    await this.backfillOrigins();
  }
  @Interval(60000)
  async backfillOrigins() {
    const rows = await this.repository.legacyOrigins(this.legacyCursor);
    if (!rows.length) return;
    await this.repository.insertOrigins(
      rows
        .filter((r) => r.bookId !== null)
        .map((r) => {
          const split = r.sourceId.indexOf(':');
          return {
            bookId: r.bookId!,
            provider: split < 0 ? 'fanqie' : r.sourceId.slice(0, split),
            providerBookId: split < 0 ? r.sourceId : r.sourceId.slice(split + 1),
            originalTitle: r.title,
          };
        }),
    );
    this.legacyCursor = rows.at(-1)!.id;
  }
  @Interval(900000)
  async cleanupExpired() {
    for (const row of await this.repository.expiredReviews()) {
      const directory = join(this.directory, row.id);
      await this.paths.assertWithinRoot(row.stagingPath, directory);
      try {
        await this.repository.withReviewLock(row.id, async () => {
          if (await this.repository.expireReview(row.id, row.userId)) await rm(directory, { recursive: true, force: true });
        });
      } catch (error) {
        if (!(error instanceof ConflictException)) throw error;
      }
    }
  }
  async list(user: RequestUser) {
    return this.repository.listReviews(user.id, await this.libraries.findEditableLibraryIds(user));
  }

  async exclusive<T>(id: string, user: RequestUser, operation: () => Promise<T>): Promise<T> {
    await this.get(id, user);
    if (this.activeCommits >= 2) throw new ServiceUnavailableException('Import confirmation is busy; retry shortly');
    this.activeCommits++;
    try {
      return await this.repository.withReviewLock(id, async () => {
        const current = await this.get(id, user);
        if (current.status === 'processing' && !current.resultBookId) await this.repository.updateReview(id, user.id, { status: 'pending' });
        return operation();
      });
    } finally {
      this.activeCommits--;
    }
  }

  async extractIdentity(path: string, filename: string, format: string, origin?: ImportOrigin): Promise<ImportIdentity> {
    const fallback = basename(filename, extname(filename));
    const identity: ImportIdentity = { title: fallback, authors: [], format, ...(origin ? { origin } : {}) };
    if (FORMATS_WITH_UNBOUNDED_METADATA_READS.has(format) && (await lstat(path)).size > MAX_BUFFERED_METADATA_BYTES) return identity;
    const parsed = await this.extraction.extract(path, format).catch(() => null);
    if (!parsed) return identity;
    const title = parsed.title && parsed.title !== basename(path, extname(path)) ? parsed.title : fallback;
    return {
      ...identity,
      title,
      authors: parsed.authors.map((a) => a.name),
      ...(parsed.isbn10 ? { isbn10: parsed.isbn10 } : {}),
      ...(parsed.isbn13 ? { isbn13: parsed.isbn13 } : {}),
    };
  }

  async checkCandidates(libraryId: number, candidates: ImportCandidateCheck[], user: RequestUser) {
    const checks = await this.matches(
      libraryId,
      candidates.map((x) => x.identity),
      user,
    );
    return candidates.map((candidate, index) => ({ key: candidate.key, matches: checks[index] ?? [] }));
  }

  async matches(
    libraryId: number,
    identities: ImportIdentity[],
    user: RequestUser,
    incoming?: { path: string; size: number },
  ): Promise<ImportDuplicateMatch[][]> {
    const { effective } = await this.policy.forLibrary(libraryId, user);
    const scope = effective.acrossLibraries ? await this.libraries.findAccessibleLibraryIds(user) : [libraryId];
    const editable = effective.acrossLibraries ? await this.libraries.findEditableLibraryIds(user) : [libraryId];
    const fingerprint = incoming && effective.contentHash ? { hash: await computeFileHash(incoming.path), size: incoming.size } : undefined;
    const found = await this.repository.findCandidates(identities, scope, effective, user, fingerprint);
    if (found.rows.length >= 200 || found.files.length > 2000 || found.authors.length > 2000 || found.origins.length > 2000)
      throw new ConflictException('Too many duplicate candidates; narrow the library scope or rules');
    let incomingSha: string | undefined;
    const contentBooks = new Set<number>();
    if (fingerprint && incoming) {
      const files = found.files.filter((f) => f.fileHash === fingerprint.hash && f.sizeBytes === fingerprint.size);
      if (files.length > 20) throw new ConflictException('Too many identical fingerprints; review duplicates before importing');
      if (files.length) incomingSha = await fullFileSha256(incoming.path);
      for (const file of files) {
        const current = await this.repository.file(file.id);
        if (!current) continue;
        await this.paths.assertWithinRoot(file.absolutePath, current.root);
        const stat = await lstat(file.absolutePath).catch(() => null);
        if (!stat?.isFile() || stat.isSymbolicLink()) continue;
        if ((await fullFileSha256(file.absolutePath)) === incomingSha) contentBooks.add(file.bookId);
      }
    }
    return identities.map((identity) =>
      found.rows
        .flatMap((row) => {
          if (
            effective.sameMediaKind &&
            importMediaKind(identity.format) !== 'unknown' &&
            importMediaKind(row.primaryFormat) !== importMediaKind(identity.format)
          )
            return [];
          const fileRows = found.files.filter((f) => f.bookId === row.bookId);
          if (!fileRows.length) return [];
          const names = found.authors.filter((a) => a.bookId === row.bookId).map((a) => a.name);
          const origins = found.origins.filter((o) => o.bookId === row.bookId);
          const reasons: ImportDuplicateReason[] = [];
          if (contentBooks.has(row.bookId)) reasons.push('content_hash');
          if (effective.sourceIdentity && identity.origin) {
            const origin = identity.origin;
            const legacyId = origin.provider === 'fanqie' ? origin.id : `${origin.provider}:${origin.id}`;
            if (
              origins.some((o) => o.provider === origin.provider && o.providerBookId === origin.id) ||
              found.completed?.some((j) => j.bookId === row.bookId && j.source === legacyId)
            )
              reasons.push('source_identity');
          }
          if (effective.isbn && importIsbn(identity) && importIsbn(identity) === importIsbn(row)) reasons.push('isbn');
          if (effective.titleAndAuthor && identity.title && identity.authors?.length) {
            const title = normalizeImportText(identity.title);
            const current = normalizeImportText(row.title ?? '') === title && matchingImportAuthors(identity.authors, names);
            const original = origins.some(
              (o) => normalizeImportText(o.originalTitle ?? '') === title && matchingImportAuthors(identity.authors!, o.originalAuthors ?? []),
            );
            if (current || original) reasons.push('title_author');
          }
          if (!reasons.length) return [];
          return [
            {
              bookId: row.bookId,
              libraryId: row.libraryId,
              libraryName: row.libraryName,
              title: row.title ?? '',
              authors: names,
              mediaKind: importMediaKind(row.primaryFormat),
              reasons,
              exact: reasons.some((r) => r !== 'title_author'),
              canEdit: editable.includes(row.libraryId),
              files: fileRows.slice(0, 50).map((f) => ({
                id: f.id,
                filename: basename(f.absolutePath),
                format: f.format,
                sizeBytes: f.sizeBytes,
                updatedAt: f.updatedAt.toISOString(),
              })),
            },
          ];
        })
        .slice(0, 20),
    );
  }

  async stage(
    path: string,
    input: { libraryId: number; folderId?: number; filename: string; format: string; sizeBytes: number; identity: ImportIdentity },
    matches: ImportDuplicateMatch[],
    user: RequestUser,
  ): Promise<never> {
    await this.libraries.verifyUserAccessLevel(user.id, input.libraryId, user.isSuperuser, 'editor');
    const id = randomUUID();
    const directory = join(this.directory, id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const destination = join(directory, `incoming.${input.format}`);
    try {
      await copyFile(path, destination, constants.COPYFILE_EXCL);
      const row = await this.repository.createReview({
        id,
        userId: user.id,
        libraryId: input.libraryId,
        folderId: input.folderId,
        filename: input.filename,
        stagingPath: destination,
        format: input.format,
        sizeBytes: input.sizeBytes,
        identity: input.identity,
        incomingSha256: await fullFileSha256(destination),
        origin: input.identity.origin,
        expiresAt: new Date(Date.now() + 24 * 3600_000),
      });
      throw new ImportReviewRequiredException({
        id,
        libraryId: row.libraryId,
        filename: row.filename,
        format: row.format,
        sizeBytes: row.sizeBytes,
        matches,
        expiresAt: row.expiresAt.toISOString(),
      });
    } catch (error) {
      if (!(error instanceof ImportReviewRequiredException)) await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }
  async get(id: string, user: RequestUser) {
    const row = await this.repository.ownedReview(id, user.id);
    if (!row) throw new NotFoundException('Import review not found');
    await this.libraries.verifyUserAccessLevel(user.id, row.libraryId, user.isSuperuser, 'editor');
    if (row.status === 'pending' && row.expiresAt.getTime() < Date.now()) throw new GoneException('Import review expired');
    await this.paths.assertWithinRoot(row.stagingPath, join(this.directory, row.id));
    return row;
  }
  async response(id: string, user: RequestUser): Promise<ImportReviewResponse> {
    const row = await this.get(id, user);
    const [matches] = await this.matches(row.libraryId, [row.identity], user, { path: row.stagingPath, size: row.sizeBytes });
    return {
      id,
      libraryId: row.libraryId,
      filename: row.filename,
      format: row.format,
      sizeBytes: row.sizeBytes,
      matches: matches ?? [],
      expiresAt: row.expiresAt.toISOString(),
    };
  }
  async claim(id: string, user: RequestUser) {
    const row = await this.get(id, user);
    if (row.status === 'completed') {
      if (!row.resultBookId) throw new GoneException('The imported book no longer exists');
      return row;
    }
    if ((await fullFileSha256(row.stagingPath)) !== row.incomingSha256) throw new ConflictException('The staged file changed; upload it again');
    const claimed = await this.repository.claimReview(id, user.id);
    if (!claimed) throw new ConflictException('Import review is already being processed');
    return claimed;
  }
  async finish(id: string, user: RequestUser, bookId: number) {
    const row = await this.get(id, user);
    await this.repository.updateReview(id, user.id, { status: 'completed', resultBookId: bookId });
    await this.repository.recordOrigin(bookId, row.identity);
    await rm(join(this.directory, id), { recursive: true, force: true });
  }
  async release(id: string, user: RequestUser) {
    await this.repository.updateReview(id, user.id, { status: 'pending' });
  }
  async discard(id: string, user: RequestUser) {
    return this.exclusive(id, user, async () => {
      const row = await this.get(id, user);
      if (row.status !== 'pending') throw new ConflictException('This import has already been processed');
      await this.repository.updateReview(id, user.id, { status: 'cancelled' });
      await rm(join(this.directory, id), { recursive: true, force: true });
    });
  }
  async filesPage(bookId: number, cursor: number | undefined, format: string | undefined, user: RequestUser) {
    const page = await this.repository.filesPage(bookId, cursor, format, user);
    if (!page) throw new NotFoundException('Book not found');
    await this.libraries.verifyUserAccessLevel(user.id, page.libraryId, user.isSuperuser, 'editor');
    return {
      items: page.files.slice(0, 50).map((file) => ({ ...file, filename: basename(file.filename) })),
      nextCursor: page.files.length > 50 ? page.files[49]!.id : null,
    };
  }
  async fileVersion(id: number, user: RequestUser) {
    const row = await this.repository.file(id, user);
    if (!row) throw new NotFoundException('File not found');
    await this.libraries.verifyUserAccessLevel(user.id, row.libraryId, user.isSuperuser, 'editor');
    await this.paths.assertWithinRoot(row.file.absolutePath, row.root);
    const stat = await lstat(row.file.absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new BadRequestException('File is not a regular library file');
    return { fileId: id, bookId: row.file.bookId, sha256: await fullFileSha256(row.file.absolutePath) };
  }
  recordOrigin(bookId: number, identity: ImportIdentity) {
    return this.repository.recordOrigin(bookId, identity);
  }
}
