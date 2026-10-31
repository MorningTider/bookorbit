<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import type { ImportDuplicateFile, ImportResolution, ImportReviewResponse } from '@bookorbit/types'
const props = defineProps<{ review: ImportReviewResponse | null; busy?: boolean; externalError?: string | null }>()
const emit = defineEmits<{ confirm: [resolution: ImportResolution]; cancel: [] }>()
const { t } = useI18n()
const action = ref<'new' | 'attach' | 'replace' | null>(null)
const bookId = ref<number | null>(null)
const fileId = ref<number | null>(null)
const loadingVersion = ref(false)
const loadingFiles = ref(false)
const fileOptions = ref<ImportDuplicateFile[]>([])
const nextCursor = ref<number | null>(null)
let fileSequence = 0
const error = ref<string | null>(null)
const editableMatches = computed(() => props.review?.matches.filter((match) => match.canEdit !== false) ?? [])
const selectedBook = computed(() => props.review?.matches.find((match) => match.bookId === bookId.value))
const replaceableFiles = computed(() => fileOptions.value.filter((file) => file.format === props.review?.format))
const canConfirm = computed(
  () =>
    !!action.value &&
    !props.busy &&
    !loadingVersion.value &&
    !loadingFiles.value &&
    (action.value === 'new' || (bookId.value !== null && (action.value !== 'replace' || fileId.value !== null))),
)
watch(
  () => props.review,
  () => {
    action.value = null
    bookId.value = editableMatches.value[0]?.bookId ?? null
    fileId.value = null
    error.value = null
  },
  { immediate: true },
)
watch([bookId, action], () => {
  fileId.value = null
  fileOptions.value = selectedBook.value?.files ?? []
  nextCursor.value = null
  if (action.value === 'replace') void loadFiles(true)
})
async function loadFiles(reset = false) {
  if (!bookId.value || !props.review) return
  const current = ++fileSequence
  const target = bookId.value
  loadingFiles.value = true
  try {
    const params = new URLSearchParams({ format: props.review.format })
    if (!reset && nextCursor.value) params.set('cursor', String(nextCursor.value))
    const response = await api(`/api/v1/imports/books/${target}/files?${params}`)
    if (!response.ok) throw new Error(t('importReview.loadFailed'))
    const data = (await response.json()) as { items: ImportDuplicateFile[]; nextCursor: number | null }
    if (current !== fileSequence || target !== bookId.value) return
    fileOptions.value = reset ? data.items : [...fileOptions.value, ...data.items]
    nextCursor.value = data.nextCursor
    if (reset && data.items.length === 1 && data.nextCursor === null) fileId.value = data.items[0]!.id
  } catch {
    if (current === fileSequence) error.value = t('importReview.loadFailed')
  } finally {
    if (current === fileSequence) loadingFiles.value = false
  }
}
function loadMoreFiles() {
  void loadFiles()
}
function close() {
  if (!props.busy && !loadingVersion.value) emit('cancel')
}
function openChange(open: boolean) {
  if (!open) close()
}
async function confirm() {
  if (!canConfirm.value || !action.value) return
  error.value = null
  if (action.value === 'new') {
    emit('confirm', { action: 'new' })
    return
  }
  if (!bookId.value) return
  if (action.value === 'attach') {
    emit('confirm', { action: 'attach', bookId: bookId.value })
    return
  }
  if (!fileId.value) return
  const targetBook = bookId.value
  const targetFile = fileId.value
  loadingVersion.value = true
  try {
    const response = await api(`/api/v1/imports/files/${targetFile}/version`)
    if (!response.ok) throw new Error(t('importReview.versionFailed'))
    const version = (await response.json()) as { fileId: number; bookId: number; sha256: string }
    if (version.bookId !== targetBook || version.fileId !== targetFile || !/^[a-f0-9]{64}$/.test(version.sha256))
      throw new Error(t('importReview.versionFailed'))
    emit('confirm', { action: 'replace', bookId: targetBook, fileId: targetFile, expectedSha256: version.sha256 })
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : t('importReview.failed')
  } finally {
    loadingVersion.value = false
  }
}
</script>
<template>
  <DialogRoot :open="review !== null" @update:open="openChange">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[80] bg-scrim" />
      <DialogContent
        data-import-review-dialog
        class="fixed left-1/2 top-1/2 z-[80] max-h-[90vh] w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border border-border bg-card p-5 shadow-xl"
      >
        <DialogTitle class="text-lg font-semibold">{{ t('importReview.title') }}</DialogTitle>
        <DialogDescription class="mt-2 text-sm text-muted-foreground">{{
          t('importReview.description', { filename: review?.filename })
        }}</DialogDescription>
        <ul class="my-4 max-h-56 space-y-2 overflow-y-auto">
          <li v-for="match in review?.matches" :key="match.bookId" class="rounded-lg border border-border p-3 text-sm">
            <p class="font-medium">{{ match.title }} · {{ match.libraryName }}</p>
            <p class="text-muted-foreground">{{ match.authors.join('、') }}</p>
            <p>{{ match.reasons.map((reason) => t(`importReview.reasons.${reason}`)).join(' · ') }}</p>
          </li>
        </ul>
        <p v-if="!review?.matches.length" class="my-3 text-sm text-muted-foreground">{{ t('importReview.pathConflict') }}</p>
        <fieldset class="space-y-3" :disabled="busy || loadingVersion">
          <legend class="mb-2 text-sm font-medium">{{ t('importReview.chooseAction') }}</legend>
          <label class="flex items-start gap-2 text-sm"
            ><input v-model="action" type="radio" value="new" class="mt-1 accent-primary" />{{ t('importReview.new') }}</label
          >
          <template v-if="editableMatches.length">
            <label class="flex items-start gap-2 text-sm"
              ><input v-model="action" type="radio" value="attach" class="mt-1 accent-primary" />{{ t('importReview.attach') }}</label
            >
            <label class="flex items-start gap-2 text-sm"
              ><input v-model="action" type="radio" value="replace" class="mt-1 accent-primary" />{{ t('importReview.replace') }}</label
            >
            <label v-if="action && action !== 'new'" class="block text-sm"
              >{{ t('importReview.targetBook') }}
              <select v-model="bookId" class="mt-1 w-full rounded-md border border-input bg-background p-2">
                <option v-for="match in editableMatches" :key="match.bookId" :value="match.bookId">
                  {{ match.title }} · {{ match.libraryName }}
                </option>
              </select>
            </label>
            <label v-if="action === 'replace'" class="block text-sm"
              >{{ t('importReview.targetFile') }}
              <select v-model="fileId" class="mt-1 w-full rounded-md border border-input bg-background p-2">
                <option :value="null">{{ t('importReview.selectFile') }}</option>
                <option v-for="file in replaceableFiles" :key="file.id" :value="file.id">{{ file.filename }}</option>
              </select>
              <Button v-if="nextCursor" variant="outline" size="sm" :disabled="loadingFiles" @click="loadMoreFiles">{{
                t('importReview.loadMore')
              }}</Button>
              <span v-if="!replaceableFiles.length && !loadingFiles" class="text-muted-foreground">{{ t('importReview.noSameFormat') }}</span>
            </label>
          </template>
        </fieldset>
        <p v-if="action === 'replace' && (review?.incomingFileCount ?? 0) > 1" class="mt-3 text-sm text-muted-foreground">
          {{ t('importReview.unitReplacementWarning', { count: review?.incomingFileCount }) }}
        </p>
        <p v-if="action === 'replace'" class="mt-4 rounded-md bg-destructive/10 p-3 text-sm">{{ t('importReview.replaceWarning') }}</p>
        <p v-if="error || externalError" role="alert" class="mt-3 text-sm text-destructive">{{ error || externalError }}</p>
        <p v-if="review?.id" class="mt-3 text-xs text-muted-foreground">{{ t('importReview.stagingNotice') }}</p>
        <div class="mt-5 flex justify-end gap-2">
          <Button variant="outline" :disabled="busy || loadingVersion" @click="close">{{ t('common.cancel') }}</Button
          ><Button :disabled="!canConfirm" :variant="action === 'replace' ? 'destructive' : 'default'" @click="confirm">{{
            t(loadingVersion ? 'importReview.checkingVersion' : 'importReview.confirm')
          }}</Button>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
