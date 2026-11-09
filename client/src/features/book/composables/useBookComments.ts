import { ref, watch, type Ref } from 'vue'
import type { BookComment, BookCommentPage, CreateBookComment } from '@bookorbit/types'
import { api } from '@/lib/api'
import { createUuid } from '@/lib/uuid'

export function useBookComments(bookId: Ref<number>) {
  const items = ref<BookComment[]>([])
  const cursor = ref<number | null>(null)
  const thread = ref<BookComment | null>(null)
  const reply = ref<BookComment | null>(null)
  const draft = ref('')
  const loading = ref(false)
  const saving = ref(false)
  const error = ref(false)
  let generation = 0
  let pending: CreateBookComment | null = null
  watch(
    draft,
    () => {
      pending = null
    },
    { flush: 'sync' },
  )

  async function load(more = false) {
    if (loading.value) return
    const current = generation
    const query = new URLSearchParams()
    if (thread.value) query.set('threadId', String(thread.value.id))
    if (more && cursor.value) query.set('before', String(cursor.value))
    loading.value = true
    error.value = false
    try {
      const response = await api(`/api/v1/books/${bookId.value}/comments?${query}`)
      if (!response.ok) throw new Error('Comment request failed')
      const page: BookCommentPage = await response.json()
      if (current !== generation) return
      items.value = more ? [...items.value, ...page.items] : page.items
      cursor.value = page.nextCursor
    } catch {
      if (current === generation) error.value = true
    } finally {
      if (current === generation) loading.value = false
    }
  }

  function openThread(comment: BookComment | null) {
    generation++
    loading.value = false
    thread.value = comment
    reply.value = comment
    draft.value = ''
    pending = null
    items.value = []
    cursor.value = null
    void load()
  }

  function replyTo(comment: BookComment) {
    reply.value = comment
    pending = null
  }

  async function send() {
    if (saving.value || !draft.value.trim()) return
    const current = generation
    pending ??= { clientId: createUuid(), body: draft.value.trim(), ...(reply.value ? { parentId: reply.value.id } : {}) }
    const payload = pending
    saving.value = true
    error.value = false
    try {
      const response = await api(`/api/v1/books/${bookId.value}/comments`, { method: 'POST', body: JSON.stringify(payload) })
      if (!response.ok) throw new Error('Comment save failed')
      if (current !== generation) return
      draft.value = ''
      pending = null
      await load()
    } catch {
      if (current === generation) error.value = true
    } finally {
      if (current === generation) saving.value = false
    }
  }

  async function remove(comment: BookComment) {
    if (saving.value) return
    const current = generation
    saving.value = true
    error.value = false
    try {
      const response = await api(`/api/v1/books/${bookId.value}/comments/${comment.id}/${comment.deleteMode ?? 'own'}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('Comment deletion failed')
      if (current === generation) await load()
    } catch {
      if (current === generation) error.value = true
    } finally {
      if (current === generation) saving.value = false
    }
  }

  watch(
    bookId,
    () => {
      generation++
      saving.value = false
      openThread(null)
    },
    { immediate: true },
  )
  return { items, cursor, thread, reply, draft, loading, saving, error, load, openThread, replyTo, send, remove }
}
