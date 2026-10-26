<script setup lang="ts">
import { onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { usePublicChapterRules } from './composables/usePublicChapterRules'
const emit = defineEmits<{ updated: [] }>()
const { t } = useI18n()
const { text, error, busy, loaded, load, save, importFile } = usePublicChapterRules()
async function saveRules() {
  if (await save()) emit('updated')
}
async function importRules(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) await importFile(file)
  input.value = ''
}
onMounted(load)
</script>
<template>
  <details class="rounded-lg border border-border p-3">
    <summary class="cursor-pointer font-medium">{{ t('chapterSources.manageRules') }}</summary>
    <p class="my-3 text-sm text-muted-foreground">{{ t('chapterSources.ruleScope') }}</p>
    <label class="mb-3 block text-sm">
      {{ t('chapterSources.importFile') }}
      <input type="file" accept=".json,application/json" :disabled="busy || !loaded" class="mt-2 block w-full text-sm" @change="importRules" />
    </label>
    <Button v-if="!loaded && !busy" variant="outline" @click="load">{{ t('common.retry') }}</Button>
    <form class="space-y-3" @submit.prevent="saveRules">
      <textarea
        v-model="text"
        :aria-label="t('chapterSources.rulesJson')"
        :disabled="busy || !loaded"
        rows="12"
        class="w-full rounded-md border border-input bg-background p-3 font-mono text-sm"
      />
      <p v-if="error" role="alert" class="text-sm text-destructive">{{ error }}</p>
      <Button type="submit" :disabled="busy || !loaded">{{ t('chapterSources.saveRules') }}</Button>
    </form>
  </details>
</template>
