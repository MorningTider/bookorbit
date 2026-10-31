import { describe, expect, it } from 'vitest';
import { BookSourceProgress } from './book-source-progress.service';
describe('single active source progress', () => {
  it('isolates users, survives repeated reads and releases the slot after completion', () => {
    const progress = new BookSourceProgress();
    progress.begin(11, 7);
    progress.update(11, { phase: 'downloading', completedChapters: 25, totalChapters: 100 });
    expect(progress.read(11, 8)).toBeUndefined();
    expect(progress.read(12, 7)).toBeUndefined();
    const snapshot = progress.read(11, 7)!;
    snapshot.completedChapters = 99;
    expect(progress.read(11, 7)?.completedChapters).toBe(25);
    progress.begin(12, 7);
    progress.end(11);
    progress.update(11, { phase: 'validating' });
    expect(progress.read(12, 7)?.phase).toBe('preparing');
    expect(progress.read(11, 7)).toBeUndefined();
    progress.end(12);
    expect(progress.read(12, 7)).toBeUndefined();
  });
});
