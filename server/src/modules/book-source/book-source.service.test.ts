import { ChapterRuleRegistry } from './chapter-rule-registry.service';
import { ChapterDownloadService } from './chapter-download.service';
import { QidianChapterSource } from './qidian-chapter-source';
import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bookSourceConfig } from '../../config/config';
import type { RequestUser } from '../../common/types/request-user';
import { LibraryService } from '../library/library.service';
import { UploadService } from '../upload/upload.service';
import { UploadValidatorService } from '../upload/upload-validator.service';
import { TomatoRuntimeService } from './tomato-runtime.service';
import { BookSourceService } from './book-source.service';

const user = { id: 7, isSuperuser: false } as RequestUser;
const verifyUserAccessLevel = vi.fn();
const upload = vi.fn();
const download = vi.fn();

async function service() {
  const module = await Test.createTestingModule({
    providers: [
      { provide: ChapterRuleRegistry, useValue: { all: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue({ key: 'sample' }) } },
      BookSourceService,
      { provide: ChapterDownloadService, useValue: { download: vi.fn() } },
      { provide: QidianChapterSource, useValue: {} },
      { provide: bookSourceConfig.KEY, useValue: { tomatoBinaryPath: '/opt/tomato/downloader' } },
      { provide: LibraryService, useValue: { verifyUserAccessLevel } },
      { provide: UploadService, useValue: { upload } },
      { provide: UploadValidatorService, useValue: { sanitizeFilename: (name: string) => name } },
      { provide: TomatoRuntimeService, useValue: { download } },
    ],
  }).compile();
  return module.get(BookSourceService);
}

describe('Book source acquisition', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    verifyUserAccessLevel.mockResolvedValue(undefined);
    download.mockResolvedValue({ content: Buffer.from('validated epub'), title: '测试小说' });
    upload.mockResolvedValue({ bookId: 11, filename: 'book.epub', format: 'epub', sizeBytes: 14 });
  });
  it('checks editor access before starting any download', async () => {
    verifyUserAccessLevel.mockRejectedValue(new ForbiddenException());
    await expect((await service()).acquireTomato(3, undefined, '7290175791344651298', user, new AbortController().signal)).rejects.toThrow(
      ForbiddenException,
    );
    expect(verifyUserAccessLevel).toHaveBeenCalledWith(7, 3, false, 'editor');
    expect(download).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });
  it('imports validated EPUB through the existing user-scoped upload service', async () => {
    const signal = new AbortController().signal;
    await expect((await service()).acquireTomato(3, 4, '7290175791344651298', user, signal)).resolves.toMatchObject({ bookId: 11 });
    expect(download).toHaveBeenCalledWith('7290175791344651298', signal);
    expect(upload).toHaveBeenCalledWith(3, 4, '测试小说.epub', expect.anything(), user);
  });
  it('never imports failed or cancelled downloads', async () => {
    download.mockRejectedValueOnce(new Error('failed'));
    await expect((await service()).acquireTomato(3, undefined, '7290175791344651298', user, new AbortController().signal)).rejects.toThrow('failed');
    const controller = new AbortController();
    controller.abort();
    await expect((await service()).acquireTomato(3, undefined, '7290175791344651298', user, controller.signal)).rejects.toThrow();
    expect(upload).not.toHaveBeenCalled();
  });
  it('does not expose executable paths in source status', async () => {
    expect((await service()).status()).toMatchObject({
      fanqie: { configured: true, format: 'epub' },
      qidian: { configured: true, scope: 'public-free-volumes' },
    });
  });
});
