import { ForbiddenException, Injectable } from '@nestjs/common';
import { ProviderConfigService } from '../metadata-preferences/provider-config.service';

@Injectable()
export class DownloadSourcePolicy {
  constructor(private readonly providers: ProviderConfigService) {}
  async enabled(source: 'fanqie' | 'qidian'): Promise<boolean> {
    const config = (await this.providers.getConfig())[source];
    return config.enabled && config.downloadEnabled !== false;
  }
  async assertEnabled(source: 'fanqie' | 'qidian') {
    if (!(await this.enabled(source))) throw new ForbiddenException('This download source is disabled');
  }
}
