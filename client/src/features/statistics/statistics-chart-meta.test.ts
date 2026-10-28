import { afterEach, describe, expect, it } from 'vitest'

import { STATISTICS_CHART_META, USER_CHART_IDS } from './statistics-chart-meta'

import { i18n, setI18nLocale } from '@/i18n'

describe('statistics chart meta', () => {
  afterEach(async () => {
    await setI18nLocale('en')
  })
  it('provides translated configuration labels for every chart', async () => {
    await setI18nLocale('zh')
    for (const meta of Object.values(STATISTICS_CHART_META)) {
      expect(i18n.global.te(meta.labelKey)).toBe(true)
      expect(i18n.global.t(meta.labelKey)).toMatch(/[\u4e00-\u9fff]/)
    }
  })
  it('places the Where You Read chart at the end of the user tab defaults', () => {
    expect(USER_CHART_IDS.at(-1)).toBe('reading-source-distribution')
  })
})
