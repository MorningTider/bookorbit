<script setup lang="ts">
import { ref, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { MessageSquare } from '@lucide/vue'
import type { BookComment, BookDetail } from '@bookorbit/types'
import { useBookComments } from '@/features/book/composables/useBookComments'
const props = defineProps<{ book: BookDetail }>()
const { t } = useI18n()
const { items, cursor, thread, reply, draft, loading, saving, error, load, openThread, replyTo, send, remove } = useBookComments(
  toRef(() => props.book.id),
)
const deleting = ref<BookComment | null>(null)
function refresh() {
  void load()
}
function more() {
  void load(true)
}
function back() {
  openThread(null)
}
function confirmDelete() {
  if (deleting.value) void remove(deleting.value)
  deleting.value = null
}
function requestDelete(item: BookComment) {
  deleting.value = item
}
function cancelDelete() {
  deleting.value = null
}
</script>
<template>
  <section class="mx-auto max-w-3xl space-y-4 pb-8">
    <header class="space-y-2">
      <h2 class="flex items-center gap-2 text-xl font-semibold"><MessageSquare class="size-5" />{{ t('bookComments.title') }}</h2>
      <p class="text-sm text-muted-foreground">{{ t('bookComments.visibility') }}</p>
      <button v-if="thread" class="text-sm text-primary" :disabled="saving" @click="back">{{ t('bookComments.back') }}</button>
    </header>
    <p v-if="error" role="alert" class="text-sm text-destructive">{{ t('bookComments.error') }}</p>
    <button class="rounded-lg border border-border px-3 py-2 text-sm" :disabled="loading" @click="refresh">{{ t('bookComments.refresh') }}</button>
    <article v-if="thread" class="rounded-xl border border-border bg-muted/30 p-4">
      <p class="font-semibold">{{ thread.authorName }}</p>
      <p class="whitespace-pre-wrap">{{ thread.deleted ? t('bookComments.deleted') : thread.body }}</p>
    </article>
    <article v-for="item in items" :key="item.id" class="space-y-3 rounded-xl border border-border bg-card p-4">
      <header class="flex flex-wrap justify-between gap-2 text-sm">
        <span class="font-semibold">{{ item.authorName }}</span
        ><time class="text-muted-foreground">{{ new Date(item.createdAt).toLocaleString() }}</time>
      </header>
      <p class="text-xs text-muted-foreground">
        {{ t(`bookComments.${item.scope}`) }}<span v-if="item.chapterTitle"> · {{ item.chapterTitle }}</span>
      </p>
      <blockquote v-if="item.quote" class="border-l-2 border-primary/40 pl-3 text-sm text-muted-foreground">{{ item.quote }}</blockquote>
      <p class="whitespace-pre-wrap break-words">{{ item.deleted ? t('bookComments.deleted') : item.body }}</p>
      <div class="flex flex-wrap gap-4 text-sm text-primary">
        <button v-if="!item.deleted" :disabled="saving" @click="replyTo(item)">{{ t('bookComments.reply') }}</button>
        <button v-if="!thread" :disabled="saving" @click="openThread(item)">{{ t('bookComments.thread') }}</button>
        <button v-if="item.canDelete && !item.deleted" :disabled="saving" @click="requestDelete(item)">{{ t('bookComments.delete') }}</button>
      </div>
    </article>
    <p v-if="loading" class="text-sm text-muted-foreground">{{ t('bookComments.loading') }}</p>
    <p v-else-if="!items.length && !error" class="py-6 text-sm text-muted-foreground">{{ t('bookComments.empty') }}</p>
    <button v-if="cursor" class="rounded-lg border border-border px-4 py-2" :disabled="loading" @click="more">{{ t('bookComments.more') }}</button>
    <form class="space-y-3 border-t border-border pt-4" @submit.prevent="send">
      <p v-if="reply" class="text-sm">{{ t('bookComments.replyTo', { name: reply.authorName }) }}</p>
      <label class="block text-sm" for="community-comment">{{ t('bookComments.write') }}</label>
      <textarea
        id="community-comment"
        v-model="draft"
        maxlength="5000"
        rows="4"
        :disabled="saving"
        class="w-full rounded-xl border border-border bg-background p-3 text-foreground"
      />
      <button type="submit" class="rounded-xl bg-primary px-5 py-2 text-primary-foreground disabled:opacity-50" :disabled="saving || !draft.trim()">
        {{ t('bookComments.send') }}
      </button>
    </form>
    <div v-if="deleting" role="alertdialog" aria-modal="true" class="fixed inset-0 z-50 grid place-items-center bg-scrim p-6">
      <div class="max-w-md space-y-4 rounded-xl border border-border bg-card p-6 shadow-lg">
        <h3 class="font-semibold">{{ t('bookComments.deleteTitle') }}</h3>
        <p>{{ t('bookComments.deleteBody') }}</p>
        <div class="flex gap-6">
          <button class="text-destructive" @click="confirmDelete">{{ t('bookComments.delete') }}</button
          ><button @click="cancelDelete">{{ t('bookComments.cancel') }}</button>
        </div>
      </div>
    </div>
  </section>
</template>
