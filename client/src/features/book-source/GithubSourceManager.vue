<script setup lang="ts">
import { watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { GITHUB_BOOK_FORMATS } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { githubSourceError } from './composables/github-source-errors'
import { useGithubSourceConfig } from './composables/useGithubSourceConfig'

const { t } = useI18n()
const emit = defineEmits<{ dirty: [value: boolean]; busy: [value: boolean] }>()
const { draft, dirty, loading, busy, error, notice, save, discard, add, remove, toggle, statusFor, test, refresh } = useGithubSourceConfig()
watch(dirty, (value) => emit('dirty', value))
watch(busy, (value) => emit('busy', value))
defineExpose({ save, discard })
</script>

<template>
  <div class="space-y-3 border-t border-border pt-3">
    <div class="flex items-center justify-between gap-3 py-2">
      <span>GitHub</span>
      <button
        type="button"
        role="switch"
        :aria-label="t('chapterSources.downloadToggle', { source: 'GitHub' })"
        :aria-checked="draft?.enabled === true"
        :disabled="!draft || busy"
        class="relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        :class="draft?.enabled ? 'bg-primary' : 'border border-border bg-muted'"
        @click="toggle"
      >
        <span
          class="pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-background shadow-xs transition-transform"
          :class="draft?.enabled ? 'translate-x-4.5' : 'translate-x-0.5'"
        />
      </button>
    </div>
    <p class="text-sm text-muted-foreground">{{ t('githubSources.scope') }}</p>
    <p v-if="loading && !draft" role="status" class="text-sm text-muted-foreground">{{ t('githubSources.loading') }}</p>
    <p v-if="error" role="alert" class="break-words text-sm text-destructive">{{ error }}</p>
    <p v-if="notice" role="status" class="text-sm text-muted-foreground">{{ notice }}</p>
    <details v-if="draft" class="space-y-3">
      <summary class="cursor-pointer text-sm font-medium">{{ t('githubSources.manage', { count: draft.repositories.length }) }}</summary>
      <p class="text-sm text-muted-foreground">{{ t('githubSources.repositoryHint') }}</p>
      <div
        v-for="(repo, index) in draft.repositories"
        :key="repo.id ?? `new-${index}`"
        class="space-y-3 rounded-lg border border-border bg-background p-3"
      >
        <div class="grid gap-3 sm:grid-cols-2">
          <label class="space-y-1 text-sm"
            ><span>{{ t('githubSources.name') }}</span
            ><input v-model="repo.label" maxlength="120" class="w-full rounded-md border border-input bg-background px-3 py-2"
          /></label>
          <label class="space-y-1 text-sm"
            ><span>{{ t('githubSources.repository') }}</span
            ><input
              v-model="repo.repository"
              placeholder="zhpelo/wenshuoge"
              maxlength="240"
              class="w-full rounded-md border border-input bg-background px-3 py-2"
          /></label>
          <label class="space-y-1 text-sm"
            ><span>{{ t('githubSources.branch') }}</span
            ><input
              v-model="repo.branch"
              :placeholder="t('githubSources.defaultBranch')"
              maxlength="200"
              class="w-full rounded-md border border-input bg-background px-3 py-2"
          /></label>
          <label class="space-y-1 text-sm"
            ><span>{{ t('githubSources.path') }}</span
            ><input
              v-model="repo.path"
              :placeholder="t('githubSources.rootFolder')"
              maxlength="1000"
              class="w-full rounded-md border border-input bg-background px-3 py-2"
          /></label>
        </div>
        <div class="flex flex-wrap gap-3 text-sm">
          <label class="flex items-center gap-2"><input v-model="repo.enabled" type="checkbox" />{{ t('githubSources.repositoryEnabled') }}</label>
          <label v-for="format in GITHUB_BOOK_FORMATS" :key="format" class="flex items-center gap-1"
            ><input v-model="repo.formats" type="checkbox" :value="format" />{{ format.toUpperCase() }}</label
          >
        </div>
        <div v-if="statusFor(repo)" class="space-y-1 text-xs text-muted-foreground">
          <p>
            {{ t(`githubSources.states.${statusFor(repo)?.indexState}`) }} ·
            {{ t('githubSources.fileCount', { count: statusFor(repo)?.fileCount ?? 0 }) }}
          </p>
          <p v-if="statusFor(repo)?.indexedAt">
            {{ t('githubSources.lastIndexed', { time: new Date(statusFor(repo)!.indexedAt!).toLocaleString() }) }}
          </p>
          <p v-if="statusFor(repo)?.error" class="break-words text-destructive">{{ githubSourceError(statusFor(repo)?.error ?? '') }}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" :disabled="dirty || busy || !repo.id" @click="test(repo)">{{
            t('githubSources.test')
          }}</Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            :disabled="dirty || busy || !repo.id || statusFor(repo)?.indexState === 'indexing'"
            @click="refresh(repo)"
            >{{ t('githubSources.refresh') }}</Button
          >
          <Button type="button" variant="outline" size="sm" :disabled="busy" @click="remove(index)">{{ t('githubSources.remove') }}</Button>
        </div>
      </div>
      <Button type="button" variant="outline" size="sm" :disabled="busy" @click="add">{{ t('githubSources.add') }}</Button>
      <p v-if="dirty" class="text-sm text-muted-foreground">{{ t('githubSources.saveFirst') }}</p>
    </details>
  </div>
</template>
