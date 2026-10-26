import { i18n } from '@/i18n'

const defaultHttpMessages = new Set([
  'Bad Request',
  'Unauthorized',
  'Forbidden',
  'Not Found',
  'Request Timeout',
  'Too Many Requests',
  'Internal Server Error',
  'Bad Gateway',
  'Service Unavailable',
  'Gateway Timeout',
])

export function sourceResponseError(message: unknown, status: number): Error {
  const detail = typeof message === 'string' ? message.trim() : ''
  if (detail && !defaultHttpMessages.has(detail)) return new Error(detail)
  if (status === 401) return new Error(i18n.global.t('chapterSources.sessionExpired'))
  if (status === 403) return new Error(i18n.global.t('chapterSources.permissionDenied'))
  if (status === 429) return new Error(i18n.global.t('chapterSources.rateLimited'))
  return new Error(i18n.global.t('chapterSources.httpError', { status }))
}

export function sourceErrorMessage(cause: unknown, fallbackKey: string): string {
  if (cause instanceof TypeError) return i18n.global.t('chapterSources.networkError')
  return cause instanceof Error && cause.message ? cause.message : i18n.global.t(fallbackKey)
}
