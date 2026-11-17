import { describe, expect, it } from 'vitest';
import { applyGenreFetchOptions } from './genre-fetch-options.utils';

describe('source genre normalization', () => {
  it('applies blocked words and limits after splitting source categories', () => {
    expect(applyGenreFetchOptions(['悬疑|已完结|推理', '破案'], new Set(['已完结']), 2)).toEqual(['悬疑', '推理']);
  });
  it('deduplicates split and standalone subjects', () => {
    expect(applyGenreFetchOptions(['历史；明史', '历史', '明史'], new Set(), null)).toEqual(['历史', '明史']);
  });
});
