import { BadGatewayException } from '@nestjs/common';

/** Only durable chapter advances renew the deadline; polling and retries do not. */
export class DownloadIdleDeadline {
  private readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private completed = 0;
  readonly signal: AbortSignal;

  constructor(
    private readonly timeoutMs: number,
    signal: AbortSignal,
  ) {
    this.signal = AbortSignal.any([signal, this.controller.signal]);
    this.renew();
  }

  advance(completed: number): boolean {
    if (this.signal.aborted || !Number.isSafeInteger(completed) || completed <= this.completed) return false;
    this.completed = completed;
    this.renew();
    return true;
  }

  dispose(): void {
    clearTimeout(this.timer);
  }

  private renew(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.controller.abort(new BadGatewayException('下载连续无新增章节，已超时停止；已下载章节保留，可重试续传'));
    }, this.timeoutMs);
    this.timer.unref();
  }
}
