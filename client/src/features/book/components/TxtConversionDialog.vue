<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription } from 'reka-ui'
import { api } from '@/lib/api'
import { usePermissions } from '@/features/auth/composables/usePermissions'
const props = defineProps<{ bookId: number; open: boolean }>()
const emit = defineEmits<{ 'update:open': [boolean]; completed: [] }>()
const { t } = useI18n()
const { hasPermission } = usePermissions()
const encoding = ref('auto')
const chapters = ref<'auto' | 'chinese' | 'english' | 'single'>('auto')
const busy = ref(false)
const error = ref('')
function handleOpen(open: boolean) {
  if (!busy.value) emit('update:open', open)
}
function handleCancel() {
  handleOpen(false)
}
async function handleRepair() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const response = await api(`/api/v1/books/${props.bookId}/repair-converted-epub`, { method: 'POST' })
    if (!response.ok) {
      error.value = t('txtConversion.repairFailed')
      return
    }
    emit('completed')
  } catch {
    error.value = t('txtConversion.repairFailed')
  } finally {
    busy.value = false
  }
}
async function handleConvert() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    const response = await api(`/api/v1/books/${props.bookId}/convert-txt-to-epub`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ encoding: encoding.value, chapters: chapters.value }),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      error.value = typeof body?.message === 'string' ? body.message : t('txtConversion.failed')
      return
    }
    emit('completed')
  } catch {
    error.value = t('txtConversion.failed')
  } finally {
    busy.value = false
  }
}
</script>
<template>
  <DialogRoot :open="props.open" @update:open="handleOpen">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-scrim" />
      <DialogContent
        class="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-card p-5 shadow-xl"
      >
        <DialogTitle class="text-lg font-semibold">{{ t('txtConversion.title') }}</DialogTitle>
        <DialogDescription class="my-3 text-sm text-muted-foreground">{{ t('txtConversion.note') }}</DialogDescription>
        <label class="block my-3 text-sm"
          >{{ t('txtConversion.encoding') }}
          <select v-model="encoding" :disabled="busy" class="mt-1 w-full rounded border border-input bg-background p-2">
            <option value="auto">{{ t('txtConversion.auto') }}</option>
            <option value="utf8">UTF-8</option>
            <option value="gb18030">GB18030 / GBK</option>
            <option value="utf16le">UTF-16 LE</option>
            <option value="utf16be">UTF-16 BE</option>
          </select>
        </label>
        <label class="block my-3 text-sm"
          >{{ t('txtConversion.chapters') }}
          <select v-model="chapters" :disabled="busy" class="mt-1 w-full rounded border border-input bg-background p-2">
            <option value="auto">{{ t('txtConversion.chapterAuto') }}</option>
            <option value="chinese">{{ t('txtConversion.chapterChinese') }}</option>
            <option value="english">{{ t('txtConversion.chapterEnglish') }}</option>
            <option value="single">{{ t('txtConversion.single') }}</option>
          </select>
        </label>
        <div v-if="hasPermission('library_delete_books')" class="my-3 rounded border border-border p-3 text-sm">
          <p class="text-muted-foreground">{{ t('txtConversion.repairNote') }}</p>
          <button :disabled="busy" class="mt-2 rounded border border-border px-3 py-2" @click="handleRepair">{{ t('txtConversion.repair') }}</button>
        </div>
        <p v-if="error" role="alert" class="my-3 text-sm text-destructive">{{ error }}</p>
        <div class="flex justify-end gap-2 mt-4">
          <button :disabled="busy" class="rounded border border-border px-3 py-2" @click="handleCancel">{{ t('txtConversion.cancel') }}</button>
          <button :disabled="busy" class="rounded bg-primary text-primary-foreground px-3 py-2 disabled:opacity-50" @click="handleConvert">
            {{ t(busy ? 'txtConversion.busy' : 'txtConversion.start') }}
          </button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
