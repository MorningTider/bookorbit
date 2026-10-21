import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { mapEntries } from './index.mjs'

const feed = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>https://www.gutenberg.org/ebooks/1342</id>
    <title>Pride &amp; Prejudice</title>
    <author><name>Jane Austen</name></author>
    <link rel="http://opds-spec.org/acquisition/open-access" type="application/epub+zip" href="/ebooks/1342.epub.images" />
  </entry>
  <entry>
    <id>https://www.gutenberg.org/ebooks/11</id>
    <title>Alice&apos;s Adventures in Wonderland</title>
    <link rel="http://opds-spec.org/acquisition/open-access" type="text/html" href="/ebooks/11.html" />
  </entry>
</feed>`

test('maps downloadable open-access EPUB entries and ignores non-EPUB entries', () => {
  assert.deepEqual(mapEntries(feed), [{
    guid: 'https://www.gutenberg.org/ebooks/1342',
    title: 'Pride & Prejudice',
    bookTitle: 'Pride & Prejudice',
    author: 'Jane Austen',
    downloadUrl: 'https://www.gutenberg.org/ebooks/1342.epub.images',
    sizeBytes: null,
    seeders: null,
    leechers: null,
    format: 'epub',
    language: 'en',
  }])
})

test('bounds the result count and rejects malformed or non-Gutenberg download links', async () => {
  assert.equal(mapEntries(feed, 0).length, 0)
  const plugin = (await import('./index.mjs')).default
  const changed = feed.replace('/ebooks/1342.epub.images', 'https://example.com/book.epub')
  assert.equal(mapEntries(changed).length, 0)
  assert.equal(typeof plugin.resolveFile, 'function')
})

test('declares a compatible direct-download plugin contract', async () => {
  const plugin = (await import('./index.mjs')).default
  assert.equal(plugin.apiVersion, 1)
  assert.equal(plugin.type, 'project-gutenberg')
  assert.deepEqual(plugin.mediaKinds, ['ebook'])
  assert.equal(plugin.seedsBack, false)
})
