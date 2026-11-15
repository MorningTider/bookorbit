// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { BOOK_FILE_WRITE_FIELDS, type BookCoverSlot, type BookDetail } from '@bookorbit/types'

import { setI18nLocale } from '@/i18n'
import { resolveWriteBackFields, writeBackFieldLabel } from '../write-back-fields'

function slot(source: BookCoverSlot['source']): BookCoverSlot {
  return { source, updatedAt: '2026-01-01T00:00:00.000Z', width: 400, height: 600 }
}

function book(overrides: Partial<BookDetail>): BookDetail {
  return {
    coverSource: null,
    covers: { ebook: null, audio: null },
    files: [],
    ...overrides,
  } as BookDetail
}

function coverValue(detail: BookDetail): string | null {
  return resolveWriteBackFields(detail, ['coverBytes'])[0]!.value
}

describe('write-back cover preview', () => {
  it('shows the book cover for an EPUB write, not the summary of both slots', () => {
    const detail = book({
      coverSource: 'custom',
      covers: { ebook: slot('extracted'), audio: slot('custom') },
      files: [
        { format: 'epub', role: 'primary' },
        { format: 'm4b', role: 'content' },
      ] as BookDetail['files'],
    })

    expect(coverValue(detail)).toBe('extracted')
  })

  it('shows the audiobook cover for an audio write, and nothing when that slot is empty', () => {
    const files = [
      { format: 'm4b', role: 'primary' },
      { format: 'epub', role: 'content' },
    ] as BookDetail['files']

    expect(coverValue(book({ covers: { ebook: slot('extracted'), audio: slot('custom') }, files }))).toBe('custom')
    expect(coverValue(book({ coverSource: 'extracted', covers: { ebook: slot('extracted'), audio: null }, files }))).toBeNull()
  })

  it('shows each written file its own medium cover when asked for a format', () => {
    const detail = book({
      covers: { ebook: slot('extracted'), audio: slot('custom') },
      files: [
        { format: 'epub', role: 'primary' },
        { format: 'm4b', role: 'content' },
      ] as BookDetail['files'],
    })

    expect(resolveWriteBackFields(detail, ['coverBytes'], 'epub')[0]!.value).toBe('extracted')
    expect(resolveWriteBackFields(detail, ['coverBytes'], 'm4b')[0]!.value).toBe('custom')
  })

  it('falls back to the single legacy cover of a book the upgrade has not reached', () => {
    expect(coverValue(book({ coverSource: 'custom', files: [{ format: 'epub', role: 'primary' }] as BookDetail['files'] }))).toBe('custom')
  })
})

describe('write-back field internationalization', () => {
  afterEach(async () => {
    await setI18nLocale('en')
  })
  it('localizes every writable field label and preserves identifier brands', async () => {
    await setI18nLocale('zh')
    for (const field of BOOK_FILE_WRITE_FIELDS) expect(writeBackFieldLabel(field)).not.toContain('book.detail.files.writeFieldLabels')
    expect(writeBackFieldLabel('publishedYear')).toBe('出版年份')
    expect(writeBackFieldLabel('coverBytes')).toBe('封面')
    expect(writeBackFieldLabel('isbn13')).toBe('ISBN-13')
    await setI18nLocale('en')
    expect(writeBackFieldLabel('publishedYear')).toBe('Published year')
  })
})
