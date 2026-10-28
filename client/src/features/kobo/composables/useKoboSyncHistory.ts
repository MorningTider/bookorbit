import { i18n } from '@/i18n'
import { ref } from 'vue'
import { api } from '@/lib/api'
import type { KoboSyncHistoryEntry } from '@bookorbit/types'

const history = ref<KoboSyncHistoryEntry[]>([])
const loading = ref(false)
let fetchPromise: Promise<void> | null = null

export function useKoboSyncHistory() {
  async function fetchHistory(limit = 20): Promise<void> {
    if (fetchPromise) return fetchPromise
    loading.value = true
    fetchPromise = api(`/api/v1/kobo/history?limit=${limit}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(i18n.global.t('customUi.runtimeMessages.failedToFetchKoboSyncHistory'))
        history.value = await res.json()
      })
      .finally(() => {
        loading.value = false
        fetchPromise = null
      })
    return fetchPromise
  }

  return { history, loading, fetchHistory }
}
