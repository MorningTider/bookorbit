import { afterEach, expect, it } from 'vitest'
import { setI18nLocale } from '@/i18n'
import { formatCommunityRatingValue } from '../community-rating'
afterEach(async () => {
  await setI18nLocale('en')
})
it('localizes the count beside provider ratings', async () => {
  await setI18nLocale('zh')
  expect(formatCommunityRatingValue(4.5, 78)).toBe('4.5 / 5 (78 条评分)')
  await setI18nLocale('en')
  expect(formatCommunityRatingValue(4.5, 78)).toBe('4.5 / 5 (78 ratings)')
})
