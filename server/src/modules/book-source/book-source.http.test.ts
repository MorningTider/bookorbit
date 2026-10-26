import { ChapterRuleRegistry } from './chapter-rule-registry.service';
import { ChapterRulesController } from './chapter-rules.controller';
import { publicRule } from '../../../test/fixtures/public-chapter-rule';
import { ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Permission } from '@bookorbit/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from '../../common/guards/permission.guard';
import type { PermissionService } from '../../common/services/permission.service';
import type { RequestUser } from '../../common/types/request-user';
import { BookSourceController } from './book-source.controller';
import { BookSourceJobService } from './book-source-job.service';
import { BookSourceService } from './book-source.service';

const jobs = { enqueueRule: vi.fn(), enqueueQidian: vi.fn(), enqueue: vi.fn(), list: vi.fn(), get: vi.fn(), cancel: vi.fn(), retry: vi.fn() };
const permissions = [Permission.LibraryUpload, Permission.BookRequestSelfFulfill];
let user: RequestUser;
let app: NestFastifyApplication;
const job = { id: 11, status: 'queued', sourceBookId: '7290175791344651298' };
beforeAll(async () => {
  const module = await Test.createTestingModule({
    controllers: [BookSourceController, ChapterRulesController],
    providers: [
      { provide: ChapterRuleRegistry, useValue: { all: vi.fn().mockResolvedValue([]), update: vi.fn().mockResolvedValue({ sources: [] }) } },
      { provide: BookSourceService, useValue: { status: () => ({ fanqie: { configured: true, format: 'epub' } }) } },
      { provide: BookSourceJobService, useValue: jobs },
    ],
  }).compile();
  app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.useGlobalGuards(
    new PermissionGuard(new Reflector(), {
      userHas: (actor: RequestUser, permission: Permission) => actor.permissions.includes(permission),
    } as PermissionService),
  );
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (request: { user?: RequestUser }, _reply: unknown, done: () => void) => {
      request.user = user;
      done();
    });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
beforeEach(() => {
  vi.resetAllMocks();
  user = { id: 7, active: true, isSuperuser: false, permissions: [...permissions] } as RequestUser;
  jobs.enqueue.mockResolvedValue(job);
  jobs.enqueueRule.mockResolvedValue({ ...job, source: 'sample', sourceBookId: '101' });
  jobs.enqueueQidian.mockResolvedValue({ ...job, source: 'qidian', sourceBookId: '1010868264' });
  jobs.list.mockResolvedValue({ items: [job], nextCursor: null });
  jobs.cancel.mockResolvedValue({ ...job, status: 'cancelled' });
  jobs.retry.mockResolvedValue(job);
});
afterAll(async () => {
  await app?.close();
});

describe('Book source HTTP contract', () => {
  it('returns an accepted job without holding a foreground download request', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/libraries/3/sources/fanqie', payload: { bookId: job.sourceBookId } });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ id: 11, status: 'queued' });
    expect(jobs.enqueue).toHaveBeenCalledWith(3, undefined, job.sourceBookId, user);
  });
  it('protects rule management separately and validates the generic download route', async () => {
    expect((await app.inject('/api/v1/book-sources/chapter-rules')).statusCode).toBe(403);
    user.permissions = [Permission.ManageBookRequests];
    expect((await app.inject({ method: 'PUT', url: '/api/v1/book-sources/chapter-rules', payload: { sources: [publicRule] } })).statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'PUT', url: '/api/v1/book-sources/chapter-rules', payload: { sources: [publicRule], script: 'test' } })).statusCode,
    ).toBe(400);
    user.permissions = [...permissions];
    const url = '/api/v1/libraries/3/sources/chapters';
    expect((await app.inject({ method: 'POST', url, payload: { source: 'sample', bookId: '101' } })).statusCode).toBe(202);
    expect(jobs.enqueueRule).toHaveBeenCalledWith(3, undefined, 'sample', '101', user);
    expect((await app.inject({ method: 'POST', url, payload: { source: 'sample', bookId: '../x' } })).statusCode).toBe(400);
  });
  it('accepts Qidian public chapter jobs and rejects arbitrary URLs or invalid source IDs', async () => {
    const url = '/api/v1/libraries/3/sources/qidian';
    expect((await app.inject({ method: 'POST', url, payload: { bookId: '1010868264' } })).statusCode).toBe(202);
    expect(jobs.enqueueQidian).toHaveBeenCalledWith(3, undefined, '1010868264', user);
    for (const payload of [{ bookId: '../x' }, { bookId: '101', url: 'http://localhost/' }])
      expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(400);
    user.permissions = [Permission.LibraryUpload];
    expect((await app.inject({ method: 'POST', url, payload: { bookId: '101' } })).statusCode).toBe(403);
  });
  it('validates the exact client DTO and query fields', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/libraries/3/sources/fanqie',
      payload: { bookId: job.sourceBookId, url: 'http://localhost/' },
    });
    expect(response.statusCode).toBe(400);
    expect(jobs.enqueue).not.toHaveBeenCalled();
    expect((await app.inject('/api/v1/book-sources/jobs?cursor=-1')).statusCode).toBe(400);
    expect((await app.inject('/api/v1/book-sources/jobs?other=1')).statusCode).toBe(400);
  });
  it('passes the actor and numeric cursor through the list route', async () => {
    const response = await app.inject('/api/v1/book-sources/jobs?cursor=20');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [job], nextCursor: null });
    expect(jobs.list).toHaveBeenCalledWith(user, 20);
  });
  it('exposes matching explicit cancellation and retry routes', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/book-sources/jobs/11/cancel' })).statusCode).toBe(200);
    expect(jobs.cancel).toHaveBeenCalledWith(11, user);
    expect((await app.inject({ method: 'POST', url: '/api/v1/book-sources/jobs/11/retry' })).statusCode).toBe(202);
    expect(jobs.retry).toHaveBeenCalledWith(11, user);
  });
  it('rejects mutations and private job reads without both permissions', async () => {
    user.permissions = [Permission.LibraryUpload];
    for (const url of ['/api/v1/book-sources/jobs/11/cancel', '/api/v1/book-sources/jobs/11/retry'])
      expect((await app.inject({ method: 'POST', url })).statusCode).toBe(403);
    expect((await app.inject('/api/v1/book-sources/jobs')).statusCode).toBe(403);
    expect(jobs.cancel).not.toHaveBeenCalled();
    expect(jobs.list).not.toHaveBeenCalled();
  });
});
