<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { onUnmounted } from 'vue'
import type { PdfReaderSettings } from '@bookorbit/types'
const { t } = useI18n()

const props = defineProps<{
  scrollMode: PdfReaderSettings['scrollMode']
  spread: PdfReaderSettings['spread']
  rotation: PdfReaderSettings['rotation']
  zoomMode: PdfReaderSettings['zoomMode']
  customScale: number
}>()

const emit = defineEmits<{
  setScrollMode: [mode: PdfReaderSettings['scrollMode']]
  setSpread: [spread: PdfReaderSettings['spread']]
  previewZoom: [scale: number]
  setZoom: [mode: PdfReaderSettings['zoomMode'], scale?: number]
  rotateBackward: []
  rotateForward: []
}>()

let zoomPreviewTimer: ReturnType<typeof setTimeout> | null = null

function selectVertical() {
  emit('setScrollMode', 'vertical')
}

function selectHorizontal() {
  emit('setScrollMode', 'horizontal')
}

function selectPage() {
  emit('setScrollMode', 'page')
}

function selectSinglePage() {
  emit('setSpread', 'none')
}

function selectOddSpread() {
  emit('setSpread', 'odd')
}

function selectEvenSpread() {
  emit('setSpread', 'even')
}

function selectAutoSpread() {
  emit('setSpread', 'auto')
}

function selectFitPage() {
  emit('setZoom', 'fit-page')
}

function selectFitWidth() {
  emit('setZoom', 'fit-width')
}

function selectAutomatic() {
  emit('setZoom', 'automatic')
}

function readZoomScale(event: Event) {
  return Number((event.target as HTMLInputElement).value)
}

function handleCustomZoomPreview(event: Event) {
  const scale = readZoomScale(event)
  if (zoomPreviewTimer) clearTimeout(zoomPreviewTimer)
  zoomPreviewTimer = setTimeout(() => {
    zoomPreviewTimer = null
    emit('previewZoom', scale)
  }, 100)
}

function handleCustomZoomCommit(event: Event) {
  if (zoomPreviewTimer) {
    clearTimeout(zoomPreviewTimer)
    zoomPreviewTimer = null
  }
  emit('setZoom', 'custom', readZoomScale(event))
}

function handleRotateBackward() {
  emit('rotateBackward')
}

function handleRotateForward() {
  emit('rotateForward')
}

onUnmounted(() => {
  if (zoomPreviewTimer) clearTimeout(zoomPreviewTimer)
})
</script>

<template>
  <div class="max-h-[min(80vh,38rem)] overflow-y-auto p-4">
    <div class="mb-5">
      <p class="settings-group-label">{{ t('uiText.pdfReaderSettingsPanel.zoom') }}</p>
      <div class="grid grid-cols-3 gap-2">
        <button
          class="rounded-md border px-3 py-2 text-xs font-medium transition-colors"
          :class="
            props.zoomMode === 'fit-page' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'
          "
          @click="selectFitPage"
        >
          {{ t('uiText.pdfReaderSettingsPanel.fitPage') }}
        </button>
        <button
          class="rounded-md border px-3 py-2 text-xs font-medium transition-colors"
          :class="
            props.zoomMode === 'fit-width' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'
          "
          @click="selectFitWidth"
        >
          {{ t('uiText.pdfReaderSettingsPanel.fitWidth') }}
        </button>
        <button
          class="rounded-md border px-3 py-2 text-xs font-medium transition-colors"
          :class="
            props.zoomMode === 'automatic' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'
          "
          @click="selectAutomatic"
        >
          {{ t('uiText.pdfReaderSettingsPanel.automatic') }}
        </button>
      </div>
      <div class="mt-3 flex items-center gap-3">
        <input
          type="range"
          min="0.25"
          max="4"
          step="0.05"
          :value="props.customScale"
          :aria-label="t('uiText.pdfReaderSettingsPanel.customZoom')"
          class="h-1 flex-1 cursor-pointer accent-primary"
          @input="handleCustomZoomPreview"
          @change="handleCustomZoomCommit"
        />
        <span class="w-12 text-right text-xs tabular-nums text-muted-foreground">{{ Math.round(props.customScale * 100) }}%</span>
      </div>
    </div>

    <div class="mb-5">
      <p class="settings-group-label">{{ t('uiText.pdfReaderSettingsPanel.layout') }}</p>
      <div class="grid grid-cols-3 gap-2">
        <button
          class="rounded-md border px-3 py-2 text-xs font-medium transition-colors"
          :class="
            props.scrollMode === 'page' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'
          "
          @click="selectPage"
        >
          {{ t('uiText.pdfReaderSettingsPanel.page') }}
        </button>
        <button
          class="rounded-md border px-3 py-2 text-xs font-medium transition-colors"
          :class="
            props.scrollMode === 'vertical'
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border text-muted-foreground hover:text-foreground'
          "
          @click="selectVertical"
        >
          {{ t('uiText.pdfReaderSettingsPanel.verticalScroll') }}
        </button>
        <button
          class="rounded-md border px-3 py-2 text-xs font-medium transition-colors"
          :class="
            props.scrollMode === 'horizontal'
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border text-muted-foreground hover:text-foreground'
          "
          @click="selectHorizontal"
        >
          {{ t('uiText.pdfReaderSettingsPanel.horizontalScroll') }}
        </button>
      </div>
    </div>

    <div class="mb-5">
      <p class="settings-group-label">{{ t('uiText.pdfReaderSettingsPanel.pageSpread') }}</p>
      <div class="grid grid-cols-4 gap-2">
        <button
          class="rounded-md border px-2 py-2 text-xs font-medium transition-colors"
          :class="props.spread === 'none' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'"
          @click="selectSinglePage"
        >
          {{ t('uiText.pdfReaderSettingsPanel.single') }}
        </button>
        <button
          class="rounded-md border px-2 py-2 text-xs font-medium transition-colors"
          :class="props.spread === 'odd' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'"
          @click="selectOddSpread"
        >
          {{ t('uiText.pdfReaderSettingsPanel.odd') }}
        </button>
        <button
          class="rounded-md border px-2 py-2 text-xs font-medium transition-colors"
          :class="props.spread === 'even' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'"
          @click="selectEvenSpread"
        >
          {{ t('uiText.pdfReaderSettingsPanel.even') }}
        </button>
        <button
          class="rounded-md border px-2 py-2 text-xs font-medium transition-colors"
          :class="props.spread === 'auto' ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:text-foreground'"
          @click="selectAutoSpread"
        >
          {{ t('uiText.pdfReaderSettingsPanel.auto') }}
        </button>
      </div>
    </div>

    <div>
      <div class="mb-2 flex items-center justify-between">
        <p class="settings-group-label !mb-0">{{ t('uiText.pdfReaderSettingsPanel.rotation') }}</p>
        <span class="text-xs tabular-nums text-muted-foreground">{{ props.rotation }}°</span>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <button
          class="rounded-md border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          @click="handleRotateBackward"
        >
          {{ t('uiText.pdfReaderSettingsPanel.rotateLeft') }}
        </button>
        <button
          class="rounded-md border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          @click="handleRotateForward"
        >
          {{ t('uiText.pdfReaderSettingsPanel.rotateRight') }}
        </button>
      </div>
    </div>
  </div>
</template>
