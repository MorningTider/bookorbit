import { describe, expect, it } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { DownloadSourcePolicy } from './download-source-policy.service';

describe('DownloadSourcePolicy', () => {
  it('keeps metadata enabled while rejecting a disabled download source', async () => {
    const policy = new DownloadSourcePolicy({ getConfig: () => Promise.resolve({ fanqie: { enabled: true, downloadEnabled: false } }) } as never);
    expect(await policy.enabled('fanqie')).toBe(false);
    await expect(policy.assertEnabled('fanqie')).rejects.toThrow(ForbiddenException);
  });
  it('requires the corresponding metadata provider and allows legacy enabled sources', async () => {
    const policy = new DownloadSourcePolicy({
      getConfig: () => Promise.resolve({ fanqie: { enabled: true }, qidian: { enabled: false, downloadEnabled: true } }),
    } as never);
    await expect(policy.assertEnabled('fanqie')).resolves.toBeUndefined();
    await expect(policy.assertEnabled('qidian')).rejects.toThrow(ForbiddenException);
  });
});
