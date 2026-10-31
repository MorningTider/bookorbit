import type { BookSourceJobProgress } from '@bookorbit/types';
import { BadGatewayException, BadRequestException } from '@nestjs/common';

export function tomatoBookId(input: string): string {
  if (/^\d{10,25}$/.test(input)) return input;
  throw new BadRequestException('番茄书籍 ID 无效');
}

export function tomatoJobId(value: unknown): number {
  if (!value || typeof value !== 'object' || !('id' in value) || !Number.isSafeInteger(value.id) || Number(value.id) < 1) {
    throw new BadGatewayException('番茄下载器未返回有效任务 ID');
  }
  return Number(value.id);
}

export function tomatoJobState(value: unknown, jobId: number, bookId: string): 'queued' | 'running' | 'done' {
  const items = objectItems(value);
  const job = items.find((item) => item.id === jobId);
  if (!job || job.book_id !== bookId) throw new BadGatewayException('番茄下载任务丢失或书籍不匹配');
  if (Array.isArray(job.book_name_options) && job.book_name_options.length) throw new BadGatewayException('下载器要求交互选择书名');
  if (Array.isArray(job.format_options) && job.format_options.length) throw new BadGatewayException('下载器要求交互选择格式');
  if (job.state !== 'queued' && job.state !== 'running' && job.state !== 'done') throw new BadGatewayException('番茄下载失败，未入库');
  return job.state;
}

export function tomatoJobProgress(value: unknown, jobId: number, bookId: string): BookSourceJobProgress | undefined {
  const job = objectItems(value).find((item) => item.id === jobId && item.book_id === bookId);
  const progress = job?.progress;
  if (!progress || typeof progress !== 'object' || !('saved_chapters' in progress) || !('chapter_total' in progress)) return;
  const completed = progress.saved_chapters;
  const total = progress.chapter_total;
  if (
    !Number.isSafeInteger(completed) ||
    !Number.isSafeInteger(total) ||
    Number(total) <= 0 ||
    Number(completed) < 0 ||
    Number(completed) > Number(total)
  )
    return;
  return { phase: 'downloading', completedChapters: Number(completed), totalChapters: Number(total) };
}

export function assertTomatoComplete(value: unknown, bookId: string): void {
  const records = objectItems(value);
  const record = records.find((item) => item.book_id === bookId);
  if (
    !record ||
    !Number.isSafeInteger(record.selected_chapters) ||
    Number(record.selected_chapters) <= 0 ||
    record.success_chapters !== record.selected_chapters ||
    record.failed_chapters !== 0
  ) {
    throw new BadGatewayException('番茄下载缺章或完整性无法确认，未入库');
  }
}

function objectItems(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== 'object' || !('items' in value) || !Array.isArray(value.items))
    throw new BadGatewayException('番茄下载器响应格式无效');
  return value.items.filter((item): item is Record<string, unknown> => item !== null && typeof item === 'object' && !Array.isArray(item));
}
