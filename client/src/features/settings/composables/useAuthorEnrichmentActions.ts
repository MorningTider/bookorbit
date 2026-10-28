import { i18n } from '@/i18n'
import { api } from '@/lib/api'
import { ignoreCachePostInit, type IgnoreCacheOptions } from '@/features/metadata-cache/lib/metadata-cache'

export function useAuthorEnrichmentActions() {
  /** Queues authors that match the eligibility conditions. */
  async function backfill(options: IgnoreCacheOptions = {}): Promise<{ queued: number }> {
    const res = await api('/api/v1/authors/enrichment/backfill', ignoreCachePostInit(options))
    if (!res.ok) throw new Error(i18n.global.t('customUi.httpMessages.hTTP', { status: res.status }))
    return res.json()
  }

  async function backfillAll(options: IgnoreCacheOptions = {}): Promise<{ queued: number }> {
    const res = await api('/api/v1/authors/enrichment/backfill-all', ignoreCachePostInit(options))
    if (!res.ok) throw new Error(i18n.global.t('customUi.httpMessages.hTTP', { status: res.status }))
    return res.json()
  }

  async function pause(): Promise<void> {
    const res = await api('/api/v1/authors/enrichment/pause', { method: 'POST' })
    if (!res.ok) throw new Error(i18n.global.t('customUi.runtimeMessages.failedToPause'))
  }

  async function resume(): Promise<void> {
    const res = await api('/api/v1/authors/enrichment/resume', { method: 'POST' })
    if (!res.ok) throw new Error(i18n.global.t('customUi.runtimeMessages.failedToResume'))
  }

  async function cancelPending(): Promise<void> {
    const res = await api('/api/v1/authors/enrichment/cancel', { method: 'POST' })
    if (!res.ok) throw new Error(i18n.global.t('customUi.runtimeMessages.failedToCancel'))
  }

  async function retryFailed(): Promise<{ requeued: number }> {
    const res = await api('/api/v1/authors/enrichment/retry-failed', { method: 'POST' })
    if (!res.ok) throw new Error(i18n.global.t('customUi.runtimeMessages.failedToRetry'))
    return res.json()
  }

  return { backfill, backfillAll, pause, resume, cancelPending, retryFailed }
}
