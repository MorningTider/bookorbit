import { AuthorMetadataProviderKey, type AuthorMetadataCandidate } from '@bookorbit/types'

export type AuthorProviderReference = {
  provider: AuthorMetadataProviderKey
  providerId: string
}

const PROVIDER_LABELS: Record<AuthorMetadataProviderKey, string> = {
  baiduBaike: '百度百科',
  douban: '豆瓣读书',
  fanqie: '番茄小说',
  qidian: '起点中文网',
  [AuthorMetadataProviderKey.GOODREADS]: 'Goodreads',
  [AuthorMetadataProviderKey.AUDNEXUS]: 'Audnexus',
}

const GOODREADS_AUTHOR_URL = /goodreads\.com\/(?:[a-z]{2}\/)?author\/(?:show|list)\/(\d+)/i
const AUDIBLE_AUTHOR_URL = /audible\.[a-z.]+\/author\/(?:[^/?#]+\/)?(B[0-9A-Z]{9})(?=[/?#]|$)/i
const AUDNEXUS_AUTHOR_URL = /audnex\.us\/authors\/(B[0-9A-Z]{9})(?=[/?#]|$)/i
const BARE_GOODREADS_ID = /^\d+$/
const BARE_ASIN = /^B[0-9A-Z]{9}$/i

/** Brand names, so never translated. Unknown keys from a newer server show as they are. */
export function authorProviderLabel(provider: string): string {
  return PROVIDER_LABELS[provider as AuthorMetadataProviderKey] ?? provider
}

/**
 * Reads a pasted Goodreads author link or id, or an Audible author link or ASIN, as the provider
 * id the server looks up. Anything else is null, so the picker can say it does not recognise it.
 */
export function parseAuthorProviderReference(input: string): AuthorProviderReference | null {
  const value = input.trim()
  if (!value) return null

  try {
    const url = new URL(value)
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port) {
      const rules: [string[], RegExp, AuthorMetadataProviderKey][] = [
        [['wapbaike.baidu.com', 'baike.baidu.com'], /^\/item\/([^/]+)\/(\d{1,20})\/?$/, AuthorMetadataProviderKey.BAIDU_BAIKE],
        [['book.douban.com'], /^\/subject\/(\d{1,20})\/?$/, AuthorMetadataProviderKey.DOUBAN],
        [['m.qidian.com', 'www.qidian.com'], /^\/author\/(\d{1,20})\/?$/, AuthorMetadataProviderKey.QIDIAN],
        [['fanqienovel.com'], /^\/author-page\/(\d{1,25})\/?$/, AuthorMetadataProviderKey.FANQIE],
      ]
      for (const [hosts, pattern, provider] of rules) {
        const match = url.pathname.match(pattern)
        if (hosts.includes(url.hostname) && match) {
          const providerId = provider === AuthorMetadataProviderKey.BAIDU_BAIKE ? `${decodeURIComponent(match[1]!)}/${match[2]}` : match[1]!
          return providerId.length <= 128 ? { provider, providerId } : null
        }
      }
    }
  } catch {
    /* A bare legacy provider identity is handled below. */
  }

  const goodreads = value.match(GOODREADS_AUTHOR_URL)?.[1] ?? (BARE_GOODREADS_ID.test(value) ? value : null)
  if (goodreads) return { provider: AuthorMetadataProviderKey.GOODREADS, providerId: goodreads }

  const asin = value.match(AUDIBLE_AUTHOR_URL)?.[1] ?? value.match(AUDNEXUS_AUTHOR_URL)?.[1] ?? (BARE_ASIN.test(value) ? value : null)
  if (asin) return { provider: AuthorMetadataProviderKey.AUDNEXUS, providerId: asin.toUpperCase() }

  return null
}

/** The provider's own page for an author, the same link the server gives a candidate as `sourceUrl`. */
export function authorProviderSourceUrl(provider: string, providerId: string): string | null {
  if (provider === AuthorMetadataProviderKey.BAIDU_BAIKE) {
    const match = providerId.match(/^([^/]{1,100})\/(\d{1,20})$/)
    return match ? `https://wapbaike.baidu.com/item/${encodeURIComponent(match[1]!)}/${match[2]}` : null
  }
  if (provider === AuthorMetadataProviderKey.DOUBAN && /^\d{1,20}$/.test(providerId)) return `https://book.douban.com/subject/${providerId}/`
  if (provider === AuthorMetadataProviderKey.QIDIAN && /^\d{1,20}$/.test(providerId)) return `https://m.qidian.com/author/${providerId}/`
  if (provider === AuthorMetadataProviderKey.FANQIE && /^\d{1,25}$/.test(providerId)) return `https://fanqienovel.com/author-page/${providerId}`
  const id = encodeURIComponent(providerId)
  if (provider === AuthorMetadataProviderKey.GOODREADS) return `https://www.goodreads.com/author/show/${id}`
  if (provider === AuthorMetadataProviderKey.AUDNEXUS) return `https://www.audible.com/author/${id}`
  return null
}

/** Birth and death years, from the full date when only that was given. */
export function candidateLifeYears(candidate: AuthorMetadataCandidate): { born: number | null; died: number | null } {
  return {
    born: candidate.birthYear ?? yearOf(candidate.birthDate),
    died: candidate.deathYear ?? yearOf(candidate.deathDate),
  }
}

function yearOf(date: string | undefined): number | null {
  const year = date ? Number(date.slice(0, 4)) : Number.NaN
  return Number.isFinite(year) ? year : null
}
