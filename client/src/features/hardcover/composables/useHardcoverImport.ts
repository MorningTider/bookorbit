import { i18n } from '@/i18n'
import { computed, ref } from 'vue'
import type { HardcoverImportApplyResult, HardcoverImportPreview } from '@bookorbit/types'
import { applyHardcoverImport, previewHardcoverImport } from '../api/hardcover.api'

const preview = ref<HardcoverImportPreview | null>(null)
const result = ref<HardcoverImportApplyResult | null>(null)
const previewing = ref(false)
const applying = ref(false)
const error = ref<string | null>(null)

const hasPreview = computed(() => preview.value !== null)
const canApply = computed(
  () => ((preview.value?.summary.willUpdate ?? 0) > 0 || (preview.value?.summary.needsReview ?? 0) > 0) && !previewing.value && !applying.value,
)

export function useHardcoverImport() {
  async function loadPreview(): Promise<void> {
    previewing.value = true
    error.value = null
    result.value = null
    try {
      preview.value = await previewHardcoverImport()
    } catch (err) {
      error.value = err instanceof Error ? err.message : i18n.global.t('customUi.fallbackErrors.failedToPreviewHardcoverImport')
    } finally {
      previewing.value = false
    }
  }

  async function applyPreview(hardcoverUserBookIds?: number[], importProgress = false): Promise<HardcoverImportApplyResult | null> {
    applying.value = true
    error.value = null
    try {
      result.value = await applyHardcoverImport({
        ...(hardcoverUserBookIds ? { hardcoverUserBookIds } : {}),
        importProgress,
      })
      preview.value = null
      return result.value
    } catch (err) {
      error.value = err instanceof Error ? err.message : i18n.global.t('customUi.fallbackErrors.failedToImportHardcoverReadStatus')
      return null
    } finally {
      applying.value = false
    }
  }

  function clearImport(): void {
    preview.value = null
    result.value = null
    error.value = null
  }

  return {
    preview,
    result,
    previewing,
    applying,
    error,
    hasPreview,
    canApply,
    loadPreview,
    applyPreview,
    clearImport,
  }
}
