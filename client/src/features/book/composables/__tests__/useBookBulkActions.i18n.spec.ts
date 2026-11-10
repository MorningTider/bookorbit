import { afterEach, describe, expect, it } from 'vitest'
import { setI18nLocale } from '@/i18n'
import { BULK_EDITABLE_FIELD_LABELS, BULK_EDITABLE_FIELD_OPTIONS } from '../useBookBulkActions'

afterEach(async () => {
  await setI18nLocale('en')
})

describe('bulk metadata field labels', () => {
  it('updates an existing field option when the interface language changes', async () => {
    await setI18nLocale('en')
    const authors = BULK_EDITABLE_FIELD_OPTIONS.find((option) => option.value === 'authors')!
    expect(authors.label).toBe('Authors')
    await setI18nLocale('zh')
    expect(authors.label).toBe('作者')
    expect(BULK_EDITABLE_FIELD_LABELS.authors).toBe('作者')
    await setI18nLocale('en')
    expect(authors.label).toBe('Authors')
  })
})
