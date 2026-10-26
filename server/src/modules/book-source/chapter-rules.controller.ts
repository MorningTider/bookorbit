import { Body, Controller, Get, Put } from '@nestjs/common';
import { Permission } from '@bookorbit/types';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ChapterRuleRegistry } from './chapter-rule-registry.service';
import { PublicChapterRulesDto } from './dto/public-chapter-rules.dto';

@Controller('book-sources/chapter-rules')
@RequirePermission(Permission.ManageBookRequests)
export class ChapterRulesController {
  constructor(private readonly registry: ChapterRuleRegistry) {}
  @Get() async all() {
    return { sources: await this.registry.all() };
  }
  @Put() update(@Body() dto: PublicChapterRulesDto) {
    return this.registry.update(dto);
  }
}
