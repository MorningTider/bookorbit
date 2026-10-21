const API_VERSION = 1
const BASE_URL = 'https://www.gutenberg.org/ebooks/search.opds/'
const ACQUISITION_REL = 'http://opds-spec.org/acquisition/open-access'
const MAX_RESULTS = 20

function decodeXml(value) {
  return value
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function elementText(xml, localName) {
  const match = xml.match(new RegExp(`<(?:(?:[\\w.-]+):)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[\\w.-]+):)?${localName}>`, 'i'))
  if (!match) return null
  return decodeXml(match[1].replace(/<[^>]*>/g, '').trim()) || null
}

function attributes(tag) {
  const result = {}
  for (const match of tag.matchAll(/([\w:.-]+)\s*=\s*(["'])(.*?)\2/g)) result[match[1]] = decodeXml(match[3])
  return result
}

export function mapEntries(xml, limit = MAX_RESULTS) {
  const entries = xml.match(/<(?:[\w.-]+:)?entry\b[^>]*>[\s\S]*?<\/(?:[\w.-]+:)?entry>/gi) ?? []
  return entries.slice(0, Math.min(limit, MAX_RESULTS)).flatMap((entry) => {
    const title = elementText(entry, 'title')
    const id = elementText(entry, 'id')
    if (!title || !id) return []

    let downloadUrl = null
    for (const match of entry.matchAll(/<(?:[\w.-]+:)?link\b[^>]*\/?\s*>/gi)) {
      const attrs = attributes(match[0])
      if (attrs.rel === ACQUISITION_REL && /^application\/epub\+zip(?:;|$)/i.test(attrs.type ?? '') && attrs.href) {
        const candidate = new URL(attrs.href, 'https://www.gutenberg.org')
        if (candidate.protocol === 'https:' && /(^|\.)gutenberg\.org$/.test(candidate.hostname)) {
          downloadUrl = candidate.href
          break
        }
      }
    }
    if (!downloadUrl) return []

    const author = elementText(entry, 'name')
    return [{
      guid: id,
      title,
      bookTitle: title,
      ...(author ? { author } : {}),
      downloadUrl,
      sizeBytes: null,
      seeders: null,
      leechers: null,
      format: 'epub',
      language: 'en',
    }]
  })
}

const plugin = {
  apiVersion: API_VERSION,
  version: '1.0.0',
  type: 'project-gutenberg',
  label: 'Project Gutenberg (public domain)',
  requiresCredential: false,
  credentialKind: null,
  mediaKinds: ['ebook'],
  usesCategories: false,
  seedsBack: false,
  defaultBaseUrl: 'https://www.gutenberg.org',
  baseUrlHint: 'Public-domain EPUB catalog. Downloads only openly accessible EPUB files.',

  async search(query, _config, host) {
    const searchText = host.buildSearchText(query).trim().slice(0, 160)
    if (!searchText) return []
    const url = new URL(BASE_URL)
    url.searchParams.set('query', searchText)
    const response = await host.fetch(url.href, { headers: { Accept: 'application/atom+xml, application/xml;q=0.9' } })
    if (!response.ok) throw host.fail(response.status === 429 ? 'throttled' : 'error', `Project Gutenberg returned HTTP ${response.status}`)
    const xml = await response.text()
    if (!/<(?:[\w.-]+:)?feed\b/i.test(xml)) throw host.fail('error', 'Project Gutenberg returned an invalid OPDS feed')
    return mapEntries(xml, query.limit)
  },

  async test(_config, host) {
    try {
      const response = await host.fetch('https://www.gutenberg.org/ebooks/search.opds/?query=pride%20and%20prejudice', {
        headers: { Accept: 'application/atom+xml, application/xml;q=0.9' },
      })
      if (!response.ok) return { success: false, error: `HTTP ${response.status}` }
      const xml = await response.text()
      return /<(?:[\w.-]+:)?feed\b/i.test(xml)
        ? { success: true, indexerName: 'Project Gutenberg' }
        : { success: false, error: 'Invalid OPDS response' }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  },

  async resolveFile(release, _config, _host) {
    const url = new URL(release.downloadUrl)
    if (url.protocol !== 'https:' || !/(^|\.)gutenberg\.org$/.test(url.hostname)) {
      throw new Error('The selected EPUB is not hosted by Project Gutenberg')
    }
    return { url: url.href, fileName: `${release.title}.epub`, sizeBytes: null, format: 'epub' }
  },
}

export default plugin
