import { sourceResponseError, sourceErrorMessage } from './source-errors'
import { i18n } from '@/i18n'
import { selectSourceDestination } from './source-destination'
import { computed, onUnmounted, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { MetadataProviderKey, Permission } from '@bookorbit/types'
import type {
  ImportDuplicateMatch,
  ImportResolution,
  ImportReviewResponse,
  PublicChapterSource,
  BookSourceRetryRequest,
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
  awaiting_choice: 'importReview.awaitingChoice',
}
export function sourceJobPercent(job: BookSourceJob): number | undefined {
  if (job.status === 'completed' || job.status === 'awaiting_choice') return 100
  const progress = job.progress
  if (
    !progress ||
    !Number.isSafeInteger(progress.completedChapters) ||
    !Number.isSafeInteger(progress.totalChapters) ||
    !progress.totalChapters ||
    progress.totalChapters < 1 ||
    progress.completedChapters! < 0 ||
    progress.completedChapters! > progress.totalChapters
  )
    return
  return Math.floor((100 * progress.completedChapters!) / progress.totalChapters)
}
export function useFanqieAcquisition() {
  const metadata = useMetadataSearch()
  const destinations = useRequestDestinationDefault()
  const { libraries, fetchLibraries } = useLibraries()
  const { hasPermission } = usePermissions()
  const { user } = useAuth()
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
  const removingJob = ref<BookSourceJob | null>(null)
  const importedMatches = ref<Record<string, ImportDuplicateMatch[]>>({})
  const reviewingDuplicate = ref<ImportReviewResponse | null>(null)
  const duplicateCandidate = ref<MetadataCandidate | null>(null)
  const checkingImports = ref(false)
  const importCheckError = ref<string | null>(null)
  let checkTimer: ReturnType<typeof setTimeout> | undefined
  let checkSequence = 0
  const reviewingImport = ref<BookSourceJob | null>(null)
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
  const enabledSources = computed(() =>
    [MetadataProviderKey.FANQIE, MetadataProviderKey.QIDIAN].filter(
      (key) => metadata.providers.value.some((provider) => provider.key === key) && status.value?.[key]?.enabled !== false && status.value !== null,
    ),
  )
  const fanqieEnabled = computed(() => enabledSources.value.length > 0)
  const configured = computed(() => enabledSources.value.some((key) => status.value?.[key]?.configured === true))
  const results = computed(() =>
    metadata.results.value.filter((candidate) => enabledSources.value.includes(candidate.provider as 'fanqie' | 'qidian')),
  )
  function existingMatch(candidate: MetadataCandidate) {
    const matches = importedMatches.value[`${candidate.provider}:${candidate.providerId}`] ?? []
    return matches.find((match) => match.exact) ?? matches[0]
  }
  async function checkImported() {
    const sequence = ++checkSequence
    const destination = libraryId.value
    if (!destination || !results.value.length || stopped) {
      importedMatches.value = {}
      checkingImports.value = false
      return
    }
    checkingImports.value = true
    try {
      const response = await readResponse<{ key: string; matches: ImportDuplicateMatch[] }[]>(
        await api('/api/v1/imports/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            libraryId: destination,
            candidates: results.value.slice(0, 40).map((candidate) => ({
              key: `${candidate.provider}:${candidate.providerId}`,
              identity: {
                title: candidate.title,
                authors: candidate.authors,
                format: 'epub',
                origin: { provider: candidate.provider, id: candidate.providerId },
                ...(candidate.isbn10 ? { isbn10: candidate.isbn10 } : {}),
                ...(candidate.isbn13 ? { isbn13: candidate.isbn13 } : {}),
              },
            })),
          }),
        }),
      )
      if (sequence === checkSequence && !stopped) {
        importedMatches.value = Object.fromEntries(response.map((row) => [row.key, row.matches]))
        importCheckError.value = null
      }
    } catch {
      if (sequence === checkSequence && !stopped) importCheckError.value = i18n.global.t('importReview.checkFailed')
    } finally {
      if (sequence === checkSequence) checkingImports.value = false
    }
  }
  watch([results, libraryId], () => {
    clearTimeout(checkTimer)
    checkSequence++
    importedMatches.value = {}
    checkTimer = setTimeout(checkImported, 300)
  })
  function canDownload(candidate: MetadataCandidate) {
    return (
      enabledSources.value.includes(candidate.provider as 'fanqie' | 'qidian') &&
      status.value?.[candidate.provider as 'fanqie' | 'qidian']?.configured === true
    )
  }

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
    if (!job.source || job.source === 'fanqie') return enabledSources.value.includes('fanqie') && status.value?.fanqie.configured === true
    if (job.source === 'qidian') return enabledSources.value.includes('qidian') && status.value?.qidian?.configured === true
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
    if (!title.value.trim() || !enabledSources.value.length) return
    error.value = null
    try {
      await metadata.search({
        title: title.value.trim(),
        providers: enabledSources.value,
        mediaKind: 'ebook',
        resultsPerProvider: 20,
      })
    } catch {
      error.value = i18n.global.t('chapterSources.searchFailed')
    }
  }

  async function acquire(candidate: MetadataCandidate) {
    const matches = importedMatches.value[`${candidate.provider}:${candidate.providerId}`] ?? []
    if (matches.length && libraryId.value) {
      duplicateCandidate.value = candidate
      reviewingDuplicate.value = {
        id: '',
        libraryId: libraryId.value,
        filename: `${candidate.title}.epub`,
        format: 'epub',
        sizeBytes: 0,
        matches,
        expiresAt: '',
      }
      error.value = null
      return
    }
    await acquireNow(candidate)
  }
  async function acquireNow(candidate: MetadataCandidate, resolution?: ImportResolution) {
    if (!canAcquire.value || !canDownload(candidate) || !libraryId.value || pendingId.value) return
    pendingId.value = candidate.providerId
    error.value = null
    try {
      const body: FanqieAcquisitionRequest = { bookId: candidate.providerId, ...(resolution ? { importResolution: resolution } : {}) }
      await readResponse<BookSourceJob>(
        await api(`/api/v1/libraries/${libraryId.value}/sources/${candidate.provider}`, {
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

  function cancelDuplicateReview() {
    if (!pendingId.value) {
      reviewingDuplicate.value = null
      duplicateCandidate.value = null
    }
  }
  async function confirmDuplicateImport(resolution: ImportResolution) {
    if (!reviewingDuplicate.value || pendingId.value) return
    if (duplicateCandidate.value) {
      const candidate = duplicateCandidate.value
      await acquireNow(candidate, resolution)
      if (!error.value) cancelDuplicateReview()
      return
    }
    const id = reviewingDuplicate.value.id
    pendingId.value = id
    try {
      await readResponse(
        await api(`/api/v1/imports/reviews/${id}/resolve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(resolution),
        }),
      )
      reviewingDuplicate.value = null
      await refreshJobs()
      await checkImported()
      error.value = null
    } catch (cause) {
      error.value = sourceErrorMessage(cause, 'importReview.failed')
    } finally {
      pendingId.value = null
    }
  }
  async function reviewJobDuplicate(job: BookSourceJob) {
    if (!job.reviewId || pendingId.value) return
    pendingId.value = String(job.id)
    error.value = null
    try {
      reviewingDuplicate.value = await readResponse<ImportReviewResponse>(await api(`/api/v1/imports/reviews/${job.reviewId}`))
      duplicateCandidate.value = null
    } catch (cause) {
      error.value = sourceErrorMessage(cause, 'importReview.loadFailed')
    } finally {
      pendingId.value = null
    }
  }
  async function act(job: BookSourceJob, action: 'cancel' | 'retry', confirmedImportNotCompleted = false) {
    if (!canAcquire.value || pendingId.value) return
    pendingId.value = String(job.id)
    error.value = null
    try {
      await readResponse<BookSourceJob>(
        await api(`/api/v1/book-sources/jobs/${job.id}/${action}`, {
          method: 'POST',
          ...(confirmedImportNotCompleted
            ? {
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ confirmedImportNotCompleted: true } satisfies BookSourceRetryRequest),
              }
            : {}),
        }),
      )
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
  function reviewImport(job: BookSourceJob) {
    if (canAcquire.value && job.status === 'failed' && !job.retryable) reviewingImport.value = job
  }
  function cancelImportReview() {
    if (!pendingId.value) reviewingImport.value = null
  }
  async function confirmImportRetry() {
    const job = reviewingImport.value
    if (!job || pendingId.value) return
    await act(job, 'retry', true)
    reviewingImport.value = null
  }
  function canRemove(job: BookSourceJob) {
    return ['completed', 'failed', 'cancelled'].includes(job.status)
  }
  function requestRemoval(job: BookSourceJob) {
    if (canAcquire.value && canRemove(job) && !pendingId.value) removingJob.value = job
  }
  function cancelRemoval() {
    if (!pendingId.value) removingJob.value = null
  }
  async function confirmRemoval() {
    const job = removingJob.value
    if (!job || !canAcquire.value || pendingId.value || !canRemove(job)) return
    pendingId.value = String(job.id)
    error.value = null
    try {
      await readResponse<BookSourceJob>(await api(`/api/v1/book-sources/jobs/${job.id}`, { method: 'DELETE' }))
      removingJob.value = null
      await refreshJobs()
    } catch (cause) {
      error.value = sourceErrorMessage(cause, 'chapterSources.actionFailed')
    } finally {
      pendingId.value = null
    }
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
    if (job.status === 'downloading' && job.progress?.phase === 'preparing') return i18n.global.t('chapterSources.preparing')
    if (job.status === 'downloading' && job.progress?.phase === 'validating') return i18n.global.t('chapterSources.validating')
    return i18n.global.t(statusLabels[job.status])
  }
  onUnmounted(() => {
    stopped = true
    clearTimeout(timer)
    clearTimeout(checkTimer)
    checkSequence++
  })
  return {
    title,
    checkingImports,
    importCheckError,
    existingMatch,
    checkImported,
    reviewingDuplicate,
    cancelDuplicateReview,
    confirmDuplicateImport,
    reviewJobDuplicate,
    canRemove,
    removingJob,
    requestRemoval,
    cancelRemoval,
    confirmRemoval,
    enabledSources,
    canDownload,
    customSources,
    customSource,
    customBookId,
    canManageSources,
    loadChapterSources,
    acquireCustom,
    canRetry,
    reviewingImport,
    reviewImport,
    cancelImportReview,
    confirmImportRetry,
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
    progressPercent: sourceJobPercent,
    results,
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
