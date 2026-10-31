import { Injectable } from '@nestjs/common';
import type { BookSourceJobProgress } from '@bookorbit/types';

@Injectable()
export class BookSourceProgress {
  private active: { id: number; userId: number; progress: BookSourceJobProgress } | null = null;

  begin(id: number, userId: number) {
    this.active = { id, userId, progress: { phase: 'preparing' } };
  }
  update(id: number, progress: BookSourceJobProgress) {
    if (this.active?.id === id) this.active.progress = { ...progress };
  }
  read(id: number, userId: number): BookSourceJobProgress | undefined {
    if (this.active?.id === id && this.active.userId === userId) return { ...this.active.progress };
  }
  end(id: number) {
    if (this.active?.id === id) this.active = null;
  }
}
