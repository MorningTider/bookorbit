<script setup lang="ts">
import { computed, ref, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { Loader2, X } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { useEpubTocOrganization } from '@/features/book/composables/useEpubTocOrganization'

const props = defineProps<{ bookId: number; fileId: number }>()
const emit = defineEmits<{ close: []; saved: [] }>()
const { t } = useI18n()
const organization = useEpubTocOrganization(
  toRef(() => props.bookId),
  toRef(() => props.fileId),
)
const { state, groups, selected, filteredRows, query, preview, loading, saving, error, changed, valid, load, suggest, clear, toggle } = organization
const scroller = ref<HTMLElement | null>(null)
const previewScroller = ref<HTMLElement | null>(null)
const virtualizer = useVirtualizer(
  computed(() => ({
    count: filteredRows.value.length,
    getScrollElement: () => scroller.value,
    estimateSize: () => 72,
    overscan: 5,
    getItemKey: (index: number) => filteredRows.value[index]?.index ?? index,
  })),
)
const previewVirtualizer = useVirtualizer(
  computed(() => ({ count: preview.value.length, getScrollElement: () => previewScroller.value, estimateSize: () => 64, overscan: 4 })),
)
const visibleRows = computed(() => virtualizer.value.getVirtualItems())
const visiblePreview = computed(() => previewVirtualizer.value.getVirtualItems())
function close() {
  if (!saving.value) emit('close')
}
function handleOpen(open: boolean) {
  if (!open) close()
}
function rename(index: number, event: Event) {
  organization.rename(index, (event.target as HTMLInputElement).value)
}
async function save() {
  if (await organization.save()) {
    toast.success(t('epubToc.saved'))
    emit('saved')
  }
}
</script>
<template>
  <DialogRoot :open="true" @update:open="handleOpen">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[70] bg-scrim" />
      <DialogContent
        class="fixed left-1/2 top-1/2 z-[70] flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-5xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-card p-5 shadow-xl focus-visible:outline-none"
      >
        <header class="flex items-start justify-between gap-4">
          <div>
            <DialogTitle class="text-lg font-semibold">{{ t('epubToc.title') }}</DialogTitle>
            <DialogDescription class="mt-1 text-sm text-muted-foreground">{{ t('epubToc.description') }}</DialogDescription>
          </div>
          <Button variant="ghost" size="icon" :disabled="saving" :aria-label="t('common.close')" @click="close"><X class="size-4" /></Button>
        </header>
        <p v-if="error" role="alert" class="mt-4 text-sm text-destructive">{{ t(`epubToc.${error}`) }}</p>
        <div v-if="loading" class="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 class="size-4 animate-spin motion-reduce:animate-none" />{{ t('epubToc.loading') }}
        </div>
        <div v-else-if="state" class="mt-4 grid min-h-0 flex-1 gap-4 overflow-y-auto md:grid-cols-2">
          <section class="min-w-0 space-y-2">
            <div class="flex flex-wrap items-center gap-2">
              <input
                v-model="query"
                type="search"
                class="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                :aria-label="t('epubToc.search')"
                :placeholder="t('epubToc.search')"
              />
              <Button variant="outline" size="sm" :disabled="saving" @click="suggest">{{ t('epubToc.suggest') }}</Button>
              <Button variant="ghost" size="sm" :disabled="saving" @click="clear">{{ t('epubToc.clear') }}</Button>
            </div>
            <p class="text-xs text-muted-foreground">{{ t('epubToc.selectStarts') }}</p>
            <div ref="scroller" class="h-80 overflow-auto rounded-lg border border-border">
              <div :style="{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }">
                <div
                  v-for="row in visibleRows"
                  :key="String(row.key)"
                  class="absolute left-0 top-0 w-full border-b border-border px-3 py-2"
                  :style="{ height: `${row.size}px`, transform: `translateY(${row.start}px)` }"
                >
                  <label class="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      :checked="selected.has(filteredRows[row.index]!.index)"
                      :disabled="saving"
                      @change="toggle(filteredRows[row.index]!.index)"
                    />
                    <span class="truncate">{{ filteredRows[row.index]!.label }}</span>
                  </label>
                  <input
                    v-if="selected.has(filteredRows[row.index]!.index)"
                    class="mt-1 h-7 w-full rounded border border-input bg-background px-2 text-sm"
                    :value="selected.get(filteredRows[row.index]!.index)"
                    maxlength="500"
                    :disabled="saving"
                    :aria-label="t('epubToc.groupName')"
                    @input="rename(filteredRows[row.index]!.index, $event)"
                  />
                </div>
              </div>
            </div>
          </section>
          <section class="min-w-0 space-y-2">
            <h3 class="font-medium">{{ t('epubToc.preview', { count: groups.length }) }}</h3>
            <p class="text-xs text-muted-foreground">{{ t('epubToc.opening') }}</p>
            <div ref="previewScroller" class="h-80 overflow-auto rounded-lg border border-border bg-muted/20">
              <p v-if="!groups.length" class="p-4 text-sm text-muted-foreground">{{ t('epubToc.noGroups') }}</p>
              <div v-else :style="{ height: `${previewVirtualizer.getTotalSize()}px`, position: 'relative' }">
                <div
                  v-for="row in visiblePreview"
                  :key="String(row.key)"
                  class="absolute left-0 top-0 w-full border-b border-border px-4 py-2"
                  :style="{ height: `${row.size}px`, transform: `translateY(${row.start}px)` }"
                >
                  <p class="truncate text-sm font-medium">{{ preview[row.index]!.label }}</p>
                  <p class="mt-1 text-xs text-muted-foreground">{{ t('epubToc.entryCount', { count: preview[row.index]!.count }) }}</p>
                </div>
              </div>
            </div>
            <p v-if="groups.length && !valid" class="text-xs text-destructive">{{ t('epubToc.invalidName') }}</p>
            <p v-if="groups.length && valid && !changed" class="text-xs text-muted-foreground">{{ t('epubToc.same') }}</p>
          </section>
        </div>
        <footer class="mt-5 flex justify-end gap-2 border-t border-border pt-4">
          <Button v-if="error" variant="outline" :disabled="loading || saving" @click="load">{{ t('epubToc.reload') }}</Button>
          <Button variant="outline" :disabled="saving" @click="close">{{ t('common.cancel') }}</Button>
          <Button :disabled="loading || saving || !changed" @click="save"
            ><Loader2 v-if="saving" class="size-4 animate-spin motion-reduce:animate-none" />{{ t('epubToc.save') }}</Button
          >
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
