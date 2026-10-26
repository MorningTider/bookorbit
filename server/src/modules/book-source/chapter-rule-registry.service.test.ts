import { Test } from '@nestjs/testing';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { storageConfig } from '../../config/config';
import { ChapterRuleRegistry, validateChapterRules } from './chapter-rule-registry.service';
import { publicRule } from '../../../test/fixtures/public-chapter-rule';
let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'bookorbit-rules-test-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
async function registry() {
  const module = await Test.createTestingModule({
    providers: [ChapterRuleRegistry, { provide: storageConfig.KEY, useValue: { appDataPath: root } }],
  }).compile();
  return module.get(ChapterRuleRegistry);
}
describe('declarative public source rules', () => {
  it('persists validated rules across service restarts', async () => {
    const instance = await registry();
    expect(await instance.all()).toEqual([]);
    await instance.update({ sources: [publicRule] });
    expect(await (await registry()).get('sample')).toMatchObject(publicRule);
  });
  it('never reuses an identity for changed rules, even after removal', async () => {
    const instance = await registry();
    await instance.update({ sources: [publicRule] });
    await expect(instance.update({ sources: [{ ...publicRule, origin: 'https://changed.example.org' }] })).rejects.toThrow('标识');
    await instance.update({ sources: [] });
    await expect(instance.update({ sources: [{ ...publicRule, bookPath: '/new/{id}/' }] })).rejects.toThrow('标识');
    expect(await instance.all()).toEqual([]);
  });
  it.each([
    { origin: 'http://books.example.org' },
    { origin: 'https://user:pass@books.example.org' },
    { bookPath: '//evil.example/{id}' },
    { bookPath: '/book/{id}/../x' },
    { key: 'qidian' },
    { contentSelector: '[' },
    { javascript: 'process.exit()' },
  ])('rejects unsafe or unsupported rules %j', (fields) => {
    expect(() => validateChapterRules({ sources: [{ ...publicRule, ...fields }] })).toThrow();
  });
  it('rejects duplicate identities and more than twenty sources', () => {
    expect(() => validateChapterRules({ sources: [publicRule, publicRule] })).toThrow();
    expect(() => validateChapterRules({ sources: Array(21).fill(publicRule) })).toThrow();
  });
});
