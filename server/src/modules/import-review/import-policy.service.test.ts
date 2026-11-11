import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_IMPORT_DUPLICATE_POLICY } from '@bookorbit/types';
import type { RequestUser } from '../../common/types/request-user';
import { ImportPolicyService } from './import-policy.service';
function setup() {
  const store = new Map<string, string>();
  const settings = {
    getValue: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setValue: vi.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
  };
  const libraries = { verifyAccessLevel: vi.fn() };
  return { store, settings, libraries, service: new ImportPolicyService(settings as never, libraries as never) };
}
const user = { id: 7, isSuperuser: false } as RequestUser;
describe('import duplicate policy inheritance', () => {
  it('keeps global defaults and independent per-library overrides, then restores inheritance', async () => {
    const { service } = setup();
    const global = { ...DEFAULT_IMPORT_DUPLICATE_POLICY, titleAndAuthor: false };
    await service.setGlobal(global);
    expect((await service.forLibrary(3, user)).effective).toEqual(global);
    const local = { ...global, acrossLibraries: true };
    expect((await service.setLibrary(3, local, user)).effective).toEqual(local);
    expect((await service.forLibrary(4, user)).effective).toEqual(global);
    expect((await service.setLibrary(3, null, user)).effective).toEqual(global);
  });
  it('checks current editor access before writing overrides and rejects an implicit reset', async () => {
    const { service, settings, libraries } = setup();
    libraries.verifyAccessLevel.mockRejectedValueOnce(new Error('denied'));
    await expect(service.setLibrary(3, DEFAULT_IMPORT_DUPLICATE_POLICY, user)).rejects.toThrow('denied');
    expect(settings.setValue).not.toHaveBeenCalled();
    await expect(service.setLibrary(3, undefined, user)).rejects.toThrow('explicit');
  });
  it('falls back safely for malformed persisted configuration', async () => {
    const { service, store } = setup();
    store.set('import_duplicate_policy', '{"contentHash":"false"}');
    expect(await service.global()).toEqual(DEFAULT_IMPORT_DUPLICATE_POLICY);
  });
});
