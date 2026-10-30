<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { onMounted } from 'vue'
import { Loader2 } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import SourceBookPreview from './SourceBookPreview.vue'
import ChapterRuleManager from './ChapterRuleManager.vue'
import { useFanqieAcquisition } from './composables/useFanqieAcquisition'

const { t } = useI18n()
const {
  source,
  customSources,
  customSource,
  customBookId,
  canManageSources,
  loadChapterSources,
  acquireCustom,
  canRetry,
  title,
  libraryId,
  editableLibraries,
  canAcquire,
  configured,
  fanqieEnabled,
  pendingId,
  jobs,
  nextCursor,
  cursor,
  taskError,
  nextPage,
  firstPage,
  statusLabel,
  retry,
  error,
  results,
  isSearching,
  hasSearched,
  providerErrors,
  load,
  search,
  acquire,
  cancel,
} = useFanqieAcquisition()
onMounted(load)
</script>

<template>
  <section class="space-y-5 rounded-xl border border-border bg-card p-4 sm:p-6" :aria-label="t('chapterSources.panel')">
    <label class="flex flex-wrap items-center gap-2 text-sm">
      {{ t('chapterSources.source') }}
      <select v-model="source" :disabled="pendingId !== null || isSearching" class="rounded-md border border-input bg-background px-3 py-2">
        <option value="fanqie">{{ t('chapterSources.fanqie') }}</option>
        <option value="qidian">{{ t('chapterSources.qidian') }}</option>
      </select>
    </label>
    <p class="text-sm text-muted-foreground">{{ t(source === 'qidian' ? 'chapterSources.publicScope' : 'chapterSources.fanqieScope') }}</p>
    <p v-if="!configured && canAcquire" role="status" class="text-sm text-muted-foreground">{{ t('chapterSources.downloaderUnavailable') }}</p>
    <p v-if="!fanqieEnabled" role="status" class="text-sm text-muted-foreground">{{ t('chapterSources.enableProvider') }}</p>
    <label v-if="canAcquire" class="flex flex-wrap items-center gap-2 text-sm">
      {{ t('chapterSources.targetLibrary') }}
      <select v-model="libraryId" :disabled="pendingId !== null" class="rounded-md border border-input bg-background px-3 py-2">
        <option :value="null">{{ t('chapterSources.selectLibrary') }}</option>
        <option v-for="library in editableLibraries" :key="library.id" :value="library.id">{{ library.name }}</option>
      </select>
    </label>
    <form class="flex flex-wrap gap-2" @submit.prevent="search">
      <input
        v-model="title"
        :aria-label="t('chapterSources.novelTitle')"
        :placeholder="t('chapterSources.titlePlaceholder')"
        maxlength="200"
        class="min-w-48 flex-1 rounded-md border border-input bg-background px-3 py-2"
      />
      <Button type="submit" :disabled="isSearching || !fanqieEnabled || !title.trim()"
        ><Loader2 v-if="isSearching" class="mr-2 size-4 animate-spin" aria-hidden="true" />{{ t('chapterSources.search') }}</Button
      >
    </form>
    <form v-if="canAcquire && customSources.length" class="flex flex-wrap gap-2" @submit.prevent="acquireCustom">
      <select
        v-model="customSource"
        :aria-label="t('chapterSources.customSource')"
        :disabled="pendingId !== null"
        class="rounded-md border border-input bg-background px-3 py-2"
      >
        <option v-for="item in customSources" :key="item.key" :value="item.key">{{ item.label }}</option>
      </select>
      <input
        v-model="customBookId"
        :aria-label="t('chapterSources.bookId')"
        :placeholder="t('chapterSources.bookId')"
        maxlength="16"
        pattern="[a-zA-Z0-9][a-zA-Z0-9_-]{0,15}"
        required
        class="min-w-40 flex-1 rounded-md border border-input bg-background px-3 py-2"
      />
      <Button type="submit" :disabled="pendingId !== null || !libraryId">{{ t('chapterSources.acquirePublic') }}</Button>
      <p class="w-full text-sm text-muted-foreground">{{ t('chapterSources.customScope') }}</p>
    </form>
    <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
    <p v-for="failure in providerErrors" :key="failure.provider" role="alert" class="text-sm text-destructive">
      {{ t('chapterSources.searchFailed') }}
    </p>
    <div v-if="pendingId" role="status" class="flex items-center gap-2 text-sm">
      <Loader2 class="size-4 animate-spin" aria-hidden="true" />{{ t('chapterSources.submitting') }}
    </div>
    <p v-if="!hasSearched && !isSearching" class="text-sm text-muted-foreground">{{ t('chapterSources.keywordHint') }}</p>
    <section class="space-y-3" aria-live="polite" :aria-label="t('chapterSources.results')">
      <h2 class="font-semibold">
        {{ t('chapterSources.results') }} <span v-if="results.length" class="text-muted-foreground">({{ results.length }})</span>
      </h2>
      <p v-if="hasSearched && !isSearching && !results.length && !providerErrors.length && !error" class="text-sm text-muted-foreground">
        {{ t('chapterSources.noResults') }}
      </p>
      <ul class="grid gap-4 lg:grid-cols-2">
        <li v-for="book in results" :key="book.providerId" class="flex flex-col gap-4 rounded-lg border border-border bg-background p-4">
          <SourceBookPreview :book="book" />
          <Button v-if="canAcquire" :disabled="!configured || !libraryId || pendingId !== null" @click="acquire(book)">{{
            t(source === 'qidian' ? 'chapterSources.acquirePublic' : 'chapterSources.acquire')
          }}</Button>
        </li>
      </ul>
    </section>
    <section v-if="canAcquire" class="space-y-3" :aria-label="t('chapterSources.tasks')">
      <h3 class="font-medium">{{ t('chapterSources.tasks') }}</h3>
      <p class="text-sm text-muted-foreground">{{ t('chapterSources.taskNote') }}</p>
      <p v-if="taskError" role="alert" class="text-sm text-destructive">{{ taskError }}</p>
      <p v-if="!jobs.length" class="text-sm text-muted-foreground">{{ t('chapterSources.noTasks') }}</p>
      <ul class="space-y-2">
        <li v-for="job in jobs" :key="job.id" class="space-y-2 rounded-lg border border-border p-3 text-sm">
          <p class="font-medium">{{ job.title || job.sourceBookId }}</p>
          <p role="status">
            {{ statusLabel(job) }}<span v-if="job.cancelRequested && job.status === 'downloading'">{{ t('chapterSources.cancelling') }}</span>
          </p>
          <p v-if="job.resultBookId">{{ t('chapterSources.importedBook', { id: job.resultBookId }) }}</p>
          <p v-if="job.error" class="text-destructive">{{ job.error }}</p>
          <Button
            v-if="job.status === 'queued' || job.status === 'downloading'"
            variant="outline"
            size="sm"
            :disabled="pendingId !== null || job.cancelRequested"
            @click="cancel(job)"
            >{{ t('chapterSources.cancelTask') }}</Button
          >
          <Button
            v-if="(job.status === 'failed' || job.status === 'cancelled') && job.retryable"
            variant="outline"
            size="sm"
            :disabled="pendingId !== null || !canRetry(job)"
            @click="retry(job)"
            >{{ t('chapterSources.retryDownload') }}</Button
          >
        </li>
      </ul>
      <div class="flex gap-2">
        <Button v-if="cursor" variant="outline" size="sm" @click="firstPage">{{ t('chapterSources.latestTasks') }}</Button>
        <Button v-if="nextCursor" variant="outline" size="sm" @click="nextPage">{{ t('chapterSources.olderTasks') }}</Button>
      </div>
    </section>

    <ChapterRuleManager v-if="canManageSources" @updated="loadChapterSources" />
  </section>
</template>
