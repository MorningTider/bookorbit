import { sourceResponseError, sourceErrorMessage } from './source-errors'
import { i18n } from '@/i18n'
import { selectSourceDestination } from './source-destination'
import { computed, onUnmounted, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { MetadataProviderKey, Permission } from '@bookorbit/types'
import type {
  PublicChapterSource,
  BookSourceJob,
  BookSourceJobPage,
  BookSourceJobStatus,
  BookSourceStatus,
  FanqieAcquisitionRequest,
  MetadataCandidate,
} from '@bookorbit/types'
import { useMetadataSearch } from '@/features/book/composables/useMetadataSearch'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useAuth } from '@/features/auth/composables/useAuth'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { api } from '@/lib/api'
import { useRequestDestinationDefault } from '@/features/book-requests/composables/useRequestDestinationDefault'

const statusLabels: Record<BookSourceJobStatus, string> = {
  queued: 'chapterSources.status.queued',
  downloading: 'chapterSources.status.downloading',
  importing: 'chapterSources.status.importing',
  completed: 'chapterSources.status.completed',
  failed: 'chapterSources.status.failed',
  cancelled: 'chapterSources.status.cancelled',
}
export function useFanqieAcquisition() {
  const metadata = useMetadataSearch()
  const destinations = useRequestDestinationDefault()
  const { libraries, fetchLibraries } = useLibraries()
  const { hasPermission } = usePermissions()
  const { user } = useAuth()
  const source = ref<'fanqie' | 'qidian'>('fanqie')
  const title = ref('')
  const customSources = ref<PublicChapterSource[]>([])
  const customSource = ref('')
  const customBookId = ref('')
  const canManageSources = computed(() => hasPermission(Permission.ManageBookRequests))
  const libraryId = ref<number | null>(null)
  const status = ref<BookSourceStatus | null>(null)
  const pendingId = ref<string | null>(null)
  const error = ref<string | null>(null)
  const jobs = ref<BookSourceJob[]>([])
  const nextCursor = ref<number | null>(null)
  const cursor = ref<number | null>(null)
  const taskError = ref<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  let refreshPromise: Promise<void> | null = null
  let refreshRequested = false
  const canAcquire = computed(() => hasPermission(Permission.LibraryUpload) && hasPermission(Permission.BookRequestSelfFulfill))
  const editableLibraries = computed(() =>
    libraries.value.filter(
      (library) =>
        library.type === 'books' &&
        (!library.allowedFormats.length || library.allowedFormats.some((format) => format.toLowerCase() === 'epub')) &&
        (user.value?.isSuperuser || library.accessLevel === 'editor' || library.accessLevel === 'owner'),
    ),
  )
  const fanqieEnabled = computed(() => metadata.providers.value.some((provider) => provider.key === source.value))
  const configured = computed(() => status.value?.[source.value]?.configured === true)

  watch(source, () => {
    metadata.cancel()
    metadata.results.value = []
    if (metadata.hasSearched) metadata.hasSearched.value = false
    error.value = null
  })

  async function readResponse<T>(response: Response): Promise<T> {
    const data: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const message = data && typeof data === 'object' && 'message' in data ? data.message : null
      throw sourceResponseError(message, response.status)
    }
    return data as T
  }

  function refreshJobs(): Promise<void> {
    if (stopped || !canAcquire.value) return Promise.resolve()
    clearTimeout(timer)
    refreshRequested = true
    if (refreshPromise) return refreshPromise
    refreshPromise = readJobs().finally(() => {
      refreshPromise = null
      if (!stopped) timer = setTimeout(refreshJobs, 3000)
    })
    return refreshPromise
  }

  async function readJobs() {
    while (refreshRequested && !stopped && canAcquire.value) {
      refreshRequested = false
      const requestedCursor = cursor.value
      try {
        const page = await readResponse<BookSourceJobPage>(
          await api(`/api/v1/book-sources/jobs${requestedCursor ? `?cursor=${requestedCursor}` : ''}`),
        )
        if (stopped || requestedCursor !== cursor.value) continue
        jobs.value = page.items
        nextCursor.value = page.nextCursor
        taskError.value = null
      } catch (cause) {
        if (!stopped && requestedCursor === cursor.value) taskError.value = sourceErrorMessage(cause, 'chapterSources.tasksFailed')
      }
    }
  }

  async function loadChapterSources() {
    if (!canAcquire.value) return
    try {
      const list = await readResponse<PublicChapterSource[]>(await api('/api/v1/book-sources/chapter-sources'))
      customSources.value = Array.isArray(list) ? list : []
      if (!customSources.value.some((item) => item.key === customSource.value)) customSource.value = customSources.value[0]?.key ?? ''
    } catch (cause) {
      taskError.value = sourceErrorMessage(cause, 'chapterSources.requestFailed')
    }
  }

  async function acquireCustom() {
    if (
      !canAcquire.value ||
      !libraryId.value ||
      pendingId.value ||
      !customSource.value ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,15}$/.test(customBookId.value)
    )
      return
    pendingId.value = customBookId.value
    error.value = null
    try {
      await readResponse<BookSourceJob>(
        await api(`/api/v1/libraries/${libraryId.value}/sources/chapters`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source: customSource.value, bookId: customBookId.value }),
        }),
      )
      cursor.value = null
      toast.success(i18n.global.t('chapterSources.queuedNotice'))
      await refreshJobs()
    } catch (cause) {
      error.value = sourceErrorMessage(cause, 'chapterSources.submitFailed')
    } finally {
      pendingId.value = null
    }
  }

  function canRetry(job: BookSourceJob) {
    if (!job.source || job.source === 'fanqie') return status.value?.fanqie.configured === true
    if (job.source === 'qidian') return status.value?.qidian?.configured === true
    return customSources.value.some((item) => item.key === job.source)
  }

  async function load() {
    await Promise.all([metadata.loadProviders(), fetchLibraries(), destinations.load()])
    if (!canAcquire.value || stopped) return
    try {
      status.value = await readResponse<BookSourceStatus>(await api('/api/v1/book-sources/status'))
      const preferredId = destinations.defaultFor('ebook').libraryId
      if (!editableLibraries.value.some((library) => library.id === libraryId.value)) {
        libraryId.value = selectSourceDestination(editableLibraries.value, preferredId)
      }
    } catch (cause) {
      error.value = sourceErrorMessage(cause, 'chapterSources.statusFailed')
    }
    await loadChapterSources()
    await refreshJobs()
  }

  async function search() {
    if (!title.value.trim()) return
    error.value = null
    try {
      await metadata.search({
        title: title.value.trim(),
        providers: [source.value === 'qidian' ? MetadataProviderKey.QIDIAN : MetadataProviderKey.FANQIE],
        mediaKind: 'ebook',
        resultsPerProvider: 20,
      })
    } catch {
      error.value = i18n.global.t('chapterSources.searchFailed')
    }
  }

  async function acquire(candidate: MetadataCandidate) {
    if (!canAcquire.value || !configured.value || !libraryId.value || pendingId.value || candidate.provider !== source.value) return
    pendingId.value = candidate.providerId
    error.value = null
    try {
      const body: FanqieAcquisitionRequest = { bookId: candidate.providerId }
      await readResponse<BookSourceJob>(
        await api(`/api/v1/libraries/${libraryId.value}/sources/${source.value}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      )
      cursor.value = null
      toast.success(i18n.global.t('chapterSources.queuedNotice'))
      await refreshJobs()
    } catch (cause) {
      error.value = sourceErrorMessage(cause, 'chapterSources.submitFailed')
    } finally {
      pendingId.value = null
    }
  }

  async function act(job: BookSourceJob, action: 'cancel' | 'retry') {
    if (!canAcquire.value || pendingId.value) return
    pendingId.value = String(job.id)
    error.value = null
    try {
      await readResponse<BookSourceJob>(await api(`/api/v1/book-sources/jobs/${job.id}/${action}`, { method: 'POST' }))
      await refreshJobs()
    } catch (cause) {
      error.value = sourceErrorMessage(cause, 'chapterSources.actionFailed')
    } finally {
      pendingId.value = null
    }
  }
  async function cancel(job: BookSourceJob) {
    await act(job, 'cancel')
  }
  async function retry(job: BookSourceJob) {
    await act(job, 'retry')
  }
  async function nextPage() {
    if (nextCursor.value) {
      cursor.value = nextCursor.value
      await refreshJobs()
    }
  }
  async function firstPage() {
    cursor.value = null
    await refreshJobs()
  }
  function statusLabel(job: BookSourceJob) {
    return i18n.global.t(statusLabels[job.status])
  }
  onUnmounted(() => {
    stopped = true
    clearTimeout(timer)
  })
  return {
    title,
    source,
    customSources,
    customSource,
    customBookId,
    canManageSources,
    loadChapterSources,
    acquireCustom,
    canRetry,
    libraryId,
    editableLibraries,
    canAcquire,
    configured,
    fanqieEnabled,
    pendingId,
    error,
    jobs,
    nextCursor,
    cursor,
    taskError,
    refreshJobs,
    nextPage,
    firstPage,
    statusLabel,
    results: computed(() => metadata.results.value.filter((candidate) => candidate.provider === source.value)),
    isSearching: metadata.isStreaming,
    hasSearched: metadata.hasSearched,
    providerErrors: metadata.interruptedProviders,
    load,
    search,
    acquire,
    cancel,
    retry,
  }
}
