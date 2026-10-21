# Project Gutenberg indexer plugin

This plugin adds a single-service, direct-download source for Project Gutenberg's public-domain
EPUB catalog. It uses the BookOrbit plugin API, searches the public OPDS feed, and returns only
HTTPS EPUB files hosted by `gutenberg.org`.

Install it from the BookOrbit administrator indexer plugin page by uploading `index.mjs`. It does
not need credentials or a second service. The source is limited to openly accessible public-domain
books and does not bypass a login, purchase, paywall, DRM, or rate limit.

Run the plugin mapper tests from this directory with:

```sh
node --test index.test.mjs
```
