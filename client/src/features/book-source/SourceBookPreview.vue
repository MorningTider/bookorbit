<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookOpen } from '@lucide/vue'
import type { MetadataCandidate } from '@bookorbit/types'
import { toDisplayCoverUrl } from '@/features/book/lib/metadata-fetch'
const props = defineProps<{ book: MetadataCandidate }>()
const { t } = useI18n()
const broken = ref(false)
const expanded = ref(false)
const cover = computed(() => toDisplayCoverUrl(props.book.coverUrl))
watch(cover, () => {
  broken.value = false
})
function toggleSynopsis() {
  expanded.value = !expanded.value
}
function onCoverError() {
  broken.value = true
}
</script>
<template>
  <div class="flex min-w-0 flex-1 gap-4">
    <div class="flex h-36 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
      <img v-if="cover && !broken" :src="cover" :alt="book.title" loading="lazy" class="size-full object-cover" @error="onCoverError" />
      <BookOpen v-else class="size-8 text-muted-foreground" aria-hidden="true" />
    </div>
    <div class="min-w-0 space-y-2">
      <h3 class="break-words text-base font-semibold">{{ book.title }}</h3>
      <p class="text-sm text-muted-foreground">{{ book.authors?.join('、') || t('chapterSources.unknownAuthor') }}</p>
      <p v-if="book.genres?.length" class="text-xs text-muted-foreground">{{ book.genres.join(' · ') }}</p>
      <p :class="expanded ? '' : 'line-clamp-3'" class="whitespace-pre-line break-words text-sm text-muted-foreground">
        {{ book.description || t('chapterSources.noSynopsis') }}
      </p>
      <button v-if="book.description" type="button" class="text-sm text-primary hover:underline" :aria-expanded="expanded" @click="toggleSynopsis">
        {{ t(expanded ? 'chapterSources.collapseSynopsis' : 'chapterSources.synopsis') }}
      </button>
    </div>
  </div>
</template>
