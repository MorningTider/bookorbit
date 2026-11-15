import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { Permission } from '@bookorbit/types';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { GithubSourceService } from './github-source.service';
import { GithubSourceConfigDto, GithubSourceSearchDto } from './dto/github-book-source.dto';

@Controller('book-sources/github')
@RequirePermission(Permission.ManageMetadataConfig)
export class GithubSourceConfigController {
  constructor(private readonly source: GithubSourceService) {}
  @Get('config') config() {
    return this.source.config();
  }
  @Put('config') update(@Body() dto: GithubSourceConfigDto) {
    return this.source.update(dto);
  }
  @Post('repositories/:id/test')
  @HttpCode(200)
  test(@Param('id', ParseIntPipe) id: number) {
    return this.source.test(id);
  }
  @Post('repositories/:id/refresh')
  @HttpCode(202)
  refresh(@Param('id', ParseIntPipe) id: number) {
    return this.source.refresh(id);
  }
}

@Controller('book-sources/github')
@RequirePermission(Permission.LibraryUpload, Permission.BookRequestSelfFulfill)
export class GithubSourceSearchController {
  constructor(private readonly source: GithubSourceService) {}
  @Get('search') search(@Query() query: GithubSourceSearchDto) {
    return this.source.search(query.query, query.cursor);
  }
}
