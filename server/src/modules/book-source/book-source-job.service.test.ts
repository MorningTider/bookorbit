import { ChapterRuleRegistry } from './chapter-rule-registry.service';
import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bookSourceConfig } from '../../config/config';
import { LibraryService } from '../library/library.service';
import { BookSourceJobRepository } from './book-source-job.repository';
import { BookSourceJobService } from './book-source-job.service';
import type { RequestUser } from '../../common/types/request-user';
const repository = { enqueue: vi.fn(), owned: vi.fn(), retry: vi.fn() };
const libraries = { verifyUserAccessLevel: vi.fn() };
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
async function service() {
  const module = await Test.createTestingModule({
    providers: [
      { provide: ChapterRuleRegistry, useValue: { all: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue({ key: 'sample' }) } },
      BookSourceJobService,
      { provide: BookSourceJobRepository, useValue: repository },
      { provide: LibraryService, useValue: libraries },
      { provide: bookSourceConfig.KEY, useValue: { tomatoBinaryPath: '' } },
    ],
  }).compile();
  return module.get(BookSourceJobService);
}
describe('chapter acquisition job identity and permissions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    repository.enqueue.mockResolvedValue(row);
    repository.owned.mockResolvedValue({ ...row, status: 'failed' });
    repository.retry.mockResolvedValue(row);
  });
  it('namespaces the durable identity while exposing a numeric source ID and provider', async () => {
    expect(await (await service()).enqueueQidian(3, undefined, '1010868264', user)).toMatchObject({ source: 'qidian', sourceBookId: '1010868264' });
    expect(repository.enqueue).toHaveBeenCalledWith(7, 3, undefined, 'qidian:1010868264');
  });
  it('requires current library editor access before queueing', async () => {
    libraries.verifyUserAccessLevel.mockRejectedValue(new ForbiddenException());
    await expect((await service()).enqueueQidian(3, undefined, '101', user)).rejects.toThrow(ForbiddenException);
    expect(repository.enqueue).not.toHaveBeenCalled();
  });
  it('does not require the unrelated Tomato binary to retry a Qidian job', async () => {
    await expect((await service()).retry(1, user)).resolves.toMatchObject({ source: 'qidian' });
    expect(repository.owned).toHaveBeenCalledWith(1, 7);
    expect(repository.retry).toHaveBeenCalledWith(1, 7);
  });
});
