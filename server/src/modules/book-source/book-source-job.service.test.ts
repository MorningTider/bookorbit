import { UploadValidatorService } from '../upload/upload-validator.service';
import { ImportReviewService } from '../import-review/import-review.service';
import { BookSourceProgress } from './book-source-progress.service';
import { DownloadSourcePolicy } from './download-source-policy.service';
import { ChapterRuleRegistry } from './chapter-rule-registry.service';
import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bookSourceConfig } from '../../config/config';
import { LibraryService } from '../library/library.service';
import { BookSourceJobRepository } from './book-source-job.repository';
import { BookSourceJobService } from './book-source-job.service';
import type { RequestUser } from '../../common/types/request-user';
const repository = { list: vi.fn(), cancel: vi.fn(), remove: vi.fn(), enqueue: vi.fn(), owned: vi.fn(), retry: vi.fn() };
const libraries = { verifyAccess: vi.fn(), findAccessibleLibraryIds: vi.fn(), verifyAccessLevel: vi.fn(), findOne: vi.fn() };
const user = { id: 7, active: true, isSuperuser: false } as RequestUser;
const row = {
  id: 1,
  libraryId: 3,
  sourceBookId: 'qidian:1010868264',
  title: '',
  status: 'queued',
  retryable: true,
  attempts: 0,
  cancelRequested: false,
  resultBookId: null,
  error: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
async function service(assertEnabled = () => Promise.resolve(undefined)) {
  const module = await Test.createTestingModule({
    providers: [
      { provide: ImportReviewService, useValue: { discard: vi.fn() } },
      BookSourceProgress,
      { provide: DownloadSourcePolicy, useValue: { enabled: () => Promise.resolve(true), assertEnabled } },
      { provide: ChapterRuleRegistry, useValue: { all: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue({ key: 'sample' }) } },
      BookSourceJobService,
      UploadValidatorService,
      { provide: BookSourceJobRepository, useValue: repository },
      { provide: LibraryService, useValue: libraries },
      { provide: bookSourceConfig.KEY, useValue: { tomatoBinaryPath: '/tools/tomato' } },
    ],
  }).compile();
  return module.get(BookSourceJobService);
}
describe('chapter acquisition job identity and permissions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    libraries.findOne.mockResolvedValue({ allowedFormats: [] });
    repository.enqueue.mockResolvedValue(row);
    repository.owned.mockResolvedValue({ ...row, status: 'failed' });
    repository.retry.mockResolvedValue(row);
  });
  it('namespaces the durable identity while exposing a numeric source ID and provider', async () => {
    expect(await (await service()).enqueueQidian(3, undefined, '1010868264', user)).toMatchObject({ source: 'qidian', sourceBookId: '1010868264' });
    expect(repository.enqueue).toHaveBeenCalledWith(7, 3, undefined, 'qidian:1010868264');
  });
  it('requires current library editor access before queueing', async () => {
    libraries.verifyAccessLevel.mockRejectedValue(new ForbiddenException());
    await expect((await service()).enqueueQidian(3, undefined, '101', user)).rejects.toThrow(ForbiddenException);
    expect(repository.enqueue).not.toHaveBeenCalled();
  });
  it.each([['fanqie'], ['qidian'], ['rule'], ['retry']])('rejects %s jobs before queue mutation when EPUB is excluded', async (entry) => {
    libraries.findOne.mockResolvedValue({ allowedFormats: ['m4a', 'txt'] });
    const jobs = await service();
    const operation =
      entry === 'fanqie'
        ? jobs.enqueue(3, undefined, '7290175791344651298', user)
        : entry === 'qidian'
          ? jobs.enqueueQidian(3, undefined, '101', user)
          : entry === 'rule'
            ? jobs.enqueueRule(3, undefined, 'sample', '101', user)
            : jobs.retry(1, user);
    await expect(operation).rejects.toThrow('does not allow .epub');
    expect(repository.enqueue).not.toHaveBeenCalled();
    expect(repository.retry).not.toHaveBeenCalled();
  });
  it('accepts an editable library that explicitly allows EPUB', async () => {
    libraries.findOne.mockResolvedValue({ allowedFormats: ['epub', 'txt'] });
    await expect((await service()).enqueueQidian(3, undefined, '101', user)).resolves.toMatchObject({ status: 'queued' });
  });

  it('does not require the unrelated Tomato binary to retry a Qidian job', async () => {
    await expect((await service()).retry(1, user)).resolves.toMatchObject({ source: 'qidian' });
    expect(repository.owned).toHaveBeenCalledWith(1, 7);
    expect(repository.retry).toHaveBeenCalledWith(1, 7);
  });
});

it('rejects enqueue and retry for a disabled download source before mutating the queue', async () => {
  repository.enqueue.mockClear();
  repository.retry.mockClear();
  repository.owned.mockResolvedValue(row);
  const jobs = await service(() => Promise.reject(new ForbiddenException('disabled')));
  await expect(jobs.enqueueQidian(3, undefined, '1010868264', user)).rejects.toThrow(ForbiddenException);
  await expect(jobs.retry(1, user)).rejects.toThrow(ForbiddenException);
  expect(repository.enqueue).not.toHaveBeenCalled();
  expect(repository.retry).not.toHaveBeenCalled();
});

it('removes only the current active user task and does not invoke library mutations', async () => {
  repository.remove.mockResolvedValue({ ...row, status: 'completed', resultBookId: 31 });
  const instance = await service();
  expect(await instance.remove(1, user)).toMatchObject({ id: 1, resultBookId: 31 });
  expect(repository.remove).toHaveBeenCalledWith(1, user.id);
  repository.remove.mockClear();
  await expect(instance.remove(1, { ...user, active: false })).rejects.toThrow(ForbiddenException);
  expect(repository.remove).not.toHaveBeenCalled();
});

describe('API key source job scope', () => {
  const scoped = {
    ...user,
    credential: { kind: 'api_key', keyId: 4, keyName: 'test', audience: 'api', access: 'write', libraryIds: [3], ownerIsSuperuser: true },
  } as RequestUser;
  beforeEach(() => {
    vi.resetAllMocks();
    repository.owned.mockResolvedValue({ ...row, status: 'failed' });
    repository.list.mockResolvedValue([]);
    libraries.findAccessibleLibraryIds.mockResolvedValue([3]);
  });
  it('filters library visibility in the paginated repository query', async () => {
    expect(await (await service()).list(scoped, 30)).toEqual({ items: [], nextCursor: null });
    expect(libraries.findAccessibleLibraryIds).toHaveBeenCalledWith(scoped);
    expect(repository.list).toHaveBeenCalledWith(7, 30, [3]);
  });
  it.each(['get', 'cancel', 'remove', 'retry'] as const)('checks the key library scope before %s', async (operation) => {
    libraries.verifyAccess.mockRejectedValue(new ForbiddenException());
    await expect((await service())[operation](1, scoped)).rejects.toThrow(ForbiddenException);
    expect(libraries.verifyAccess).toHaveBeenCalledWith(scoped, 3);
    expect(repository.cancel).not.toHaveBeenCalled();
    expect(repository.remove).not.toHaveBeenCalled();
    expect(repository.retry).not.toHaveBeenCalled();
  });
  it('preserves the existing interactive history query', async () => {
    await (await service()).list(user, 30);
    expect(repository.list).toHaveBeenCalledWith(7, 30);
    expect(libraries.findAccessibleLibraryIds).not.toHaveBeenCalled();
  });
});
