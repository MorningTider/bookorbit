import { afterEach, describe, expect, it, vi } from 'vitest';
import { DownloadIdleDeadline } from './download-idle-deadline';

afterEach(() => vi.useRealTimers());
describe('chapter progress deadline', () => {
  it('allows hours of real chapter advances without a total runtime limit', () => {
    vi.useFakeTimers();
    const idle = new DownloadIdleDeadline(600_000, new AbortController().signal);
    for (let chapter = 1; chapter <= 100; chapter++) {
      vi.advanceTimersByTime(540_000);
      expect(idle.advance(chapter)).toBe(true);
      expect(idle.signal.aborted).toBe(false);
    }
    idle.dispose();
    vi.advanceTimersByTime(600_000);
    expect(idle.signal.aborted).toBe(false);
  });
  it('does not renew on heartbeat, unchanged counts, decreases or invalid values', () => {
    vi.useFakeTimers();
    const idle = new DownloadIdleDeadline(1000, new AbortController().signal);
    idle.advance(5);
    vi.advanceTimersByTime(600);
    for (const count of [5, 0, 4, NaN, Infinity, 5.5]) expect(idle.advance(count)).toBe(false);
    vi.advanceTimersByTime(400);
    expect(idle.signal.aborted).toBe(true);
    expect(idle.signal.reason.message).toContain('无新增章节');
    expect(idle.advance(6)).toBe(false);
    idle.dispose();
  });
  it('bounds startup and respects immediate user cancellation', () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const idle = new DownloadIdleDeadline(1000, controller.signal);
    controller.abort();
    expect(idle.signal.aborted).toBe(true);
    expect(idle.advance(1)).toBe(false);
    idle.dispose();
    const startup = new DownloadIdleDeadline(1000, new AbortController().signal);
    vi.advanceTimersByTime(1000);
    expect(startup.signal.aborted).toBe(true);
    startup.dispose();
  });
});
