import { i18n } from '@/i18n'

const messages: Record<string, string> = {
  'Invalid GitHub book catalog': 'catalog',
  'Invalid GitHub response': 'response',
  'The operation was aborted due to timeout': 'timeout',
  'GitHub configuration changed; reload before saving': 'changed',
  'Unknown or duplicate repository id': 'unknownId',
  'GitHub repository no longer exists': 'missingRepo',
  'Repository is already being indexed': 'indexRunning',
  'Repository is already being indexed or was removed': 'indexBusy',
  'Repository indexing lease expired': 'leaseExpired',
  'Repository configuration changed during indexing': 'indexChanged',
  'Search result expired; search again': 'stale',
  'GitHub source or repository is disabled': 'disabled',
  'Repository configuration changed; submit a fresh search result': 'sourceChanged',
  'Use a GitHub owner/repository address': 'address',
  'Invalid repository folder': 'folder',
  'Repository name or branch is invalid': 'nameBranch',
  'Invalid GitHub file snapshot': 'snapshot',
  'GitHub rate limit or access restriction; retry later': 'rateLimit',
  'GitHub default branch is missing': 'branch',
  'Invalid GitHub commit': 'commit',
  'Configured repository folder does not exist': 'missingFolder',
  'Invalid or oversized GitHub tree': 'tree',
  'Invalid GitHub tree path': 'path',
  'GitHub directory is truncated': 'truncated',
  'Repository index exceeds 100000 entries': 'indexLimit',
  'Duplicate repository branch and folder': 'duplicate',
  'GitHub source is disabled': 'off',
  'Search result changed; search again': 'resultChanged',
  'Two repository indexes are running; retry when one finishes': 'indexConcurrency',
  'No supported ebook files found; check the folder and formats. External download indexes need a separate adapter': 'noFiles',
  'GitHub ebook size is invalid': 'fileSize',
  'Download stalled with no new bytes; retry the task': 'stalled',
  'GitHub file exceeds its indexed size': 'oversize',
  'GitHub file size or blob hash does not match the indexed version': 'hash',
  'GitHub task snapshot is missing or invalid': 'invalidFile',
  'GitHub task snapshot is missing': 'missingSnapshot',
  'GitHub source is unavailable': 'unavailable',
  'fetch failed': 'fetchFailed',
}

export function githubSourceError(message: string): string {
  const key = messages[message]
  if (key) return i18n.global.t(`githubSources.errors.${key}`)
  const http = message.match(/^GitHub (?:request|file download) failed \(HTTP (\d+)\)$/)
  if (http) return i18n.global.t('githubSources.httpError', { status: http[1] })
  if (/^The response was larger than the \d+ byte limit$/.test(message)) return i18n.global.t('githubSources.errors.responseSize')
  const format = message.match(/^File contents do not match the \.(\w+) format$/)
  if (format) return i18n.global.t('githubSources.formatError', { format: format[1]?.toUpperCase() })
  return message
}
