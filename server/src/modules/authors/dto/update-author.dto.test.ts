import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { UpdateAuthorDto } from './update-author.dto';

describe('UpdateAuthorDto preview portrait', () => {
  it('accepts a source identity together with ordinary edits', async () => {
    expect(
      await validate(plainToInstance(UpdateAuthorDto, { description: 'Edited', previewImage: { provider: 'baiduBaike', providerId: 'Author/42' } }), {
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    ).toEqual([]);
  });
  it.each([
    { provider: 'unknown', providerId: '42' },
    { provider: 'baiduBaike', providerId: '' },
    { provider: 'baiduBaike', providerId: '42', imageUrl: 'http://localhost/private' },
    'not an identity',
  ])('rejects invalid or arbitrary-image payloads: %j', async (previewImage) => {
    expect(
      (await validate(plainToInstance(UpdateAuthorDto, { previewImage }), { whitelist: true, forbidNonWhitelisted: true })).length,
    ).toBeGreaterThan(0);
  });
});
