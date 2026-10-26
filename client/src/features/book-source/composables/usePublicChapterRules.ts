import { sourceResponseError, sourceErrorMessage } from './source-errors'
import { i18n } from '@/i18n'
import { ref } from 'vue'
import type { PublicChapterRulesUpdate } from '@bookorbit/types'
import { api } from '@/lib/api'

export function usePublicChapterRules() {
  const text = ref('{"sources": []}')
  const error = ref<string | null>(null)
  const busy = ref(false)
  const loaded = ref(false)
  async function read(response: Response) {
    const data = await response.json().catch(() => null)
    if (!response.ok) throw sourceResponseError(data?.message, response.status)
    return data as PublicChapterRulesUpdate
  }
  async function load() {
    if (busy.value) return
    loaded.value = false
    busy.value = true
    error.value = null
    try {
      text.value = JSON.stringify(await read(await api('/api/v1/book-sources/chapter-rules')), null, 2)
      loaded.value = true
    } catch (cause) {
      error.value = sourceErrorMessage(cause, 'chapterSources.rulesLoadFailed')
    } finally {
      busy.value = false
    }
  }
  async function importFile(file: File) {
    if (busy.value || !loaded.value) return
    error.value = null
    if (file.size > 256 * 1024) {
      error.value = i18n.global.t('chapterSources.rulesTooLarge')
      return
    }
    busy.value = true
    try {
      text.value = JSON.stringify(JSON.parse(await file.text()), null, 2)
    } catch {
      error.value = i18n.global.t('chapterSources.rulesInvalidJson')
    } finally {
      busy.value = false
    }
  }
  async function save() {
    if (busy.value || !loaded.value) return false
    busy.value = true
    error.value = null
    try {
      if (new TextEncoder().encode(text.value).byteLength > 256 * 1024) throw new Error(i18n.global.t('chapterSources.rulesTooLarge'))
      let body: unknown
      try {
        body = JSON.parse(text.value)
      } catch {
        throw new Error(i18n.global.t('chapterSources.rulesInvalidJson'))
      }
      const data = await read(
        await api('/api/v1/book-sources/chapter-rules', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      )
      text.value = JSON.stringify(data, null, 2)
      return true
    } catch (cause) {
      error.value = sourceErrorMessage(cause, 'chapterSources.rulesUpdateFailed')
      return false
    } finally {
      busy.value = false
    }
  }
  return { text, error, busy, loaded, load, save, importFile }
}
