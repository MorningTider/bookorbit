import { api } from '@/lib/api'
import { REQUEST_LANGUAGE_CODES } from '@bookorbit/types'
import { formatLanguageName } from '@/i18n/formatters'

function createSearchFn(endpoint: string) {
  return async (q: string): Promise<string[]> => {
    if (!q.trim()) return []
    const res = await api(`${endpoint}?q=${encodeURIComponent(q)}`)
    if (!res.ok) return []
    const data: { name: string }[] = await res.json()
    return data.map((d) => d.name)
  }
}

export function usePublisherSearch() {
  return { search: createSearchFn('/api/v1/metadata/publishers') }
}

export function useSeriesNameSearch() {
  return { search: createSearchFn('/api/v1/metadata/series') }
}

export function useLanguageSearch() {
  const storedLanguages = createSearchFn('/api/v1/metadata/languages')
  const codes = ['zh-Hans', 'zh-Hant', ...REQUEST_LANGUAGE_CODES]
  const englishNames = new Intl.DisplayNames(['en'], { type: 'language' })
  async function search(query: string): Promise<string[]> {
    const text = query.trim().toLocaleLowerCase()
    if (!text) return []
    const matches = codes.filter((code) =>
      [code, formatLanguageName(code), englishNames.of(code) ?? ''].some((value) => value.toLocaleLowerCase().includes(text)),
    )
    const stored = await storedLanguages(query).catch(() => [])
    return [...new Set([...matches, ...stored])].slice(0, 30)
  }
  return { search }
}
