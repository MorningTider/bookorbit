import { describe, expect, it } from 'vitest';
import { normalizeSourceSubjects } from './source-subjects.utils';

describe('normalizeSourceSubjects', () => {
  it('splits provider separators and deduplicates without guessing categories', () => {
    expect(normalizeSourceSubjects(['悬疑|推理|破案', '推理；现代刑侦', ' Science Fiction ', 'science fiction'])).toEqual([
      '悬疑',
      '推理',
      '破案',
      '现代刑侦',
      'Science Fiction',
    ]);
  });
  it('bounds names and result count and leaves compound subjects intact', () => {
    expect(normalizeSourceSubjects(['', ' '.repeat(3), 'a'.repeat(121), 'Books, Fiction & Literature', '历史/明代'])).toEqual([
      'Books, Fiction & Literature',
      '历史/明代',
    ]);
    expect(normalizeSourceSubjects(Array.from({ length: 100 }, (_, i) => `subject-${i}`))).toHaveLength(50);
  });
});
