import { BadRequestException, Injectable } from '@nestjs/common';
import { DEFAULT_IMPORT_DUPLICATE_POLICY, type ImportDuplicatePolicy, type ImportPolicyResponse } from '@bookorbit/types';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { LibraryService } from '../library/library.service';
import type { RequestUser } from '../../common/types/request-user';

const GLOBAL_KEY = 'import_duplicate_policy';
function parsePolicy(raw: string | null): ImportDuplicatePolicy | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const data = value as Record<string, unknown>;
    const result = { ...DEFAULT_IMPORT_DUPLICATE_POLICY };
    for (const key of Object.keys(result) as (keyof ImportDuplicatePolicy)[]) {
      if (typeof data[key] !== 'boolean') return null;
      result[key] = data[key] as boolean;
    }
    return result;
  } catch {
    return null;
  }
}
@Injectable()
export class ImportPolicyService {
  constructor(
    private readonly settings: AppSettingsService,
    private readonly libraries: LibraryService,
  ) {}
  async global(): Promise<ImportDuplicatePolicy> {
    return parsePolicy(await this.settings.getValue(GLOBAL_KEY)) ?? { ...DEFAULT_IMPORT_DUPLICATE_POLICY };
  }
  async forLibrary(libraryId: number, user: RequestUser): Promise<ImportPolicyResponse> {
    await this.libraries.verifyUserAccessLevel(user.id, libraryId, user.isSuperuser, 'editor');
    const [global, override] = await Promise.all([this.global(), this.settings.getValue(`${GLOBAL_KEY}:library:${libraryId}`).then(parsePolicy)]);
    return { global, override, effective: override ?? global };
  }
  async setGlobal(policy: ImportDuplicatePolicy) {
    await this.settings.setValue(GLOBAL_KEY, JSON.stringify(policy));
    return this.global();
  }
  async setLibrary(libraryId: number, policy: ImportDuplicatePolicy | null | undefined, user: RequestUser) {
    if (policy === undefined) throw new BadRequestException('An explicit policy or null is required');
    await this.libraries.verifyUserAccessLevel(user.id, libraryId, user.isSuperuser, 'editor');
    await this.settings.setValue(`${GLOBAL_KEY}:library:${libraryId}`, JSON.stringify(policy));
    return this.forLibrary(libraryId, user);
  }
}
