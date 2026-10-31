<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ImportResolution, ImportReviewResponse } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import ImportReviewDialog from './ImportReviewDialog.vue'
const emit = defineEmits<{ imported: [bookId: number, libraryId: number] }>()
const { t } = useI18n()
const rows = ref<{ id: string; filename: string; format: string; status: string }[]>([])
const review = ref<ImportReviewResponse | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)
async function load() {
  try {
    const response = await api('/api/v1/imports/reviews')
    if (!response.ok) throw new Error()
    rows.value = await response.json()
    error.value = null
  } catch {
    error.value = t('importReview.loadFailed')
  }
}
async function open(id: string) {
  if (busy.value) return
  busy.value = true
  try {
    const response = await api(`/api/v1/imports/reviews/${id}`)
    if (!response.ok) throw new Error()
    review.value = await response.json()
  } catch {
    error.value = t('importReview.loadFailed')
  } finally {
    busy.value = false
  }
}
function close() {
  if (!busy.value) review.value = null
}
async function resolve(resolution: ImportResolution) {
  if (!review.value || busy.value) return
  busy.value = true
  try {
    const response = await api(`/api/v1/imports/reviews/${review.value.id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(resolution),
    })
    if (!response.ok) throw new Error()
    const result = (await response.json()) as { bookId: number }
    const libraryId =
      resolution.action === 'new'
        ? review.value.libraryId
        : (review.value.matches.find((match) => match.bookId === resolution.bookId)?.libraryId ?? review.value.libraryId)
    review.value = null
    emit('imported', result.bookId, libraryId)
    await load()
  } catch {
    error.value = t('importReview.failed')
  } finally {
    busy.value = false
  }
}
async function discard(id: string) {
  if (busy.value) return
  busy.value = true
  try {
    const response = await api(`/api/v1/imports/reviews/${id}`, { method: 'DELETE' })
    if (!response.ok) throw new Error()
    await load()
  } catch {
    error.value = t('importReview.failed')
  } finally {
    busy.value = false
  }
}
onMounted(load)
defineExpose({ load })
</script>
<template>
  <section class="space-y-2" :aria-label="t('importReview.pending')">
    <div class="flex items-center justify-between gap-2">
      <h3 class="font-medium">{{ t('importReview.pending') }}</h3>
      <Button size="sm" variant="outline" :disabled="busy" @click="load">{{ t('importReview.refresh') }}</Button>
    </div>
    <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
    <p v-if="!rows.length" class="text-sm text-muted-foreground">{{ t('importReview.nonePending') }}</p>
    <ul class="space-y-2">
      <li v-for="row in rows" :key="row.id" class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm">
        <span>{{ row.filename }} · {{ row.format.toUpperCase() }}</span
        ><Button variant="outline" size="sm" :disabled="busy" @click="open(row.id)">{{ t('importReview.review') }}</Button
        ><Button variant="outline" size="sm" :disabled="busy || row.status !== 'pending'" @click="discard(row.id)">{{
          t('importReview.discard')
        }}</Button>
      </li>
    </ul>
    <ImportReviewDialog :review="review" :busy="busy" :external-error="error" @confirm="resolve" @cancel="close" />
  </section>
</template>
