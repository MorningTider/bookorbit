import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { Permission } from '@bookorbit/types';
import { PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { AcquireTomatoDto } from './dto/acquire-tomato.dto';
import { BookSourceController } from './book-source.controller';

describe('book source API contract', () => {
  it('accepts exactly the supported client fields', async () => {
    const dto = plainToInstance(AcquireTomatoDto, { bookId: '7290175791344651298', folderId: 2 });
    await expect(validate(dto, { whitelist: true, forbidNonWhitelisted: true })).resolves.toEqual([]);
    const invalid = plainToInstance(AcquireTomatoDto, { bookId: '7290175791344651298', url: 'http://127.0.0.1/' });
    expect(await validate(invalid, { whitelist: true, forbidNonWhitelisted: true })).not.toHaveLength(0);
  });
  it('rejects malformed book IDs and folder IDs', async () => {
    for (const body of [{ bookId: '../secret' }, { bookId: '7290175791344651298', folderId: -1 }])
      expect(await validate(plainToInstance(AcquireTomatoDto, body))).not.toHaveLength(0);
  });
  it('requires both upload and direct-download permissions server-side', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, BookSourceController)).toEqual([Permission.LibraryUpload, Permission.BookRequestSelfFulfill]);
  });
});
