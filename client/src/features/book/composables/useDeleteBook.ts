import { i18n } from '@/i18n'
import { ref } from 'vue'
import { api } from '@/lib/api'
import { toast } from 'vue-sonner'

export function useDeleteBook(onDeleted: (id: number) => void) {
  const pendingId = ref<number | null>(null)
  const deleting = ref(false)

  function promptDelete(id: number) {
    pendingId.value = id
  }

  function cancelDelete() {
    pendingId.value = null
  }

  async function confirmDelete() {
    if (pendingId.value === null) return
    const id = pendingId.value
    deleting.value = true
    try {
      const res = await api('/api/v1/books', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookIds: [id] }),
      })
      if (!res.ok) {
        toast.error(i18n.global.t('customUi.runtimeMessages.failedToDeleteBook'))
        return
      }
      onDeleted(id)
      toast.success(i18n.global.t('customUi.runtimeMessages.bookDeleted'))
    } finally {
      deleting.value = false
      pendingId.value = null
    }
  }

  return { pendingId, deleting, promptDelete, cancelDelete, confirmDelete }
}
