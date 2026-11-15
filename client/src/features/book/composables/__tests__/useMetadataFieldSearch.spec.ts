import { afterEach, describe, expect, it, vi } from 'vitest'
import { setI18nLocale } from '@/i18n'
import { api } from '@/lib/api'
import { useLanguageSearch } from '../useMetadataFieldSearch'
vi.mock('@/lib/api', () => ({ api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>() }))
afterEach(async () => {
  vi.resetAllMocks()
  await setI18nLocale('en')
})
describe('metadata language suggestions', () => {
  it('finds standardized script tags by their translated language names', async () => {
    await setI18nLocale('zh')
    vi.mocked(api).mockResolvedValue({ ok: true, json: async () => [] } as unknown as Response)
    const { search } = useLanguageSearch()
    expect(await search('简体中文')).toContain('zh-Hans')
    expect(await search('繁体')).toContain('zh-Hant')
    expect(await search('English')).toContain('en')
  })
  it('keeps existing custom values and supplies local choices when lookup fails', async () => {
    vi.mocked(api).mockResolvedValue({ ok: true, json: async () => [{ name: 'Custom Chinese edition' }] } as unknown as Response)
    const { search } = useLanguageSearch()
    expect(await search('Chinese')).toContain('Custom Chinese edition')
    vi.mocked(api).mockRejectedValue(new Error('Offline'))
    expect(await search('zh-Hans')).toContain('zh-Hans')
  })
})
