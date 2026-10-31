import { defineComponent, h, watchEffect, nextTick } from 'vue'
import { setI18nLocale } from '@/i18n'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookSourceJob, MetadataCandidate } from '@bookorbit/types'

vi.mock('@/features/book-requests/composables/useRequestDestinationDefault', () => ({
  useRequestDestinationDefault: () => ({ load: vi.fn(), defaultFor: () => ({ libraryId: null }) }),
}))

const mocks = vi.hoisted(() => ({ api: vi.fn(), hasPermission: vi.fn(), extraEditor: false, search: vi.fn(), cancel: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: mocks.api }))
vi.mock('@/features/auth/composables/usePermissions', () => ({ usePermissions: () => ({ hasPermission: mocks.hasPermission }) }))
vi.mock('@/features/auth/composables/useAuth', async () => {
  const { ref } = await import('vue')
  return { useAuth: () => ({ user: ref({ id: 7, isSuperuser: false }) }) }
})
vi.mock('@/features/library/composables/useLibraries', async () => {
  const { ref } = await import('vue')
  return {
    useLibraries: () => ({
      libraries: ref([
        { id: 3, type: 'books', name: '电子书', allowedFormats: ['epub'], accessLevel: 'editor' },
        { id: 4, type: 'books', name: '只读', allowedFormats: [], accessLevel: 'viewer' },
        ...(mocks.extraEditor ? [{ id: 9, type: 'books', name: '另一个可写书库', allowedFormats: [], accessLevel: 'editor' }] : []),
      ]),
      fetchLibraries: vi.fn(),
    }),
  }
})
vi.mock('@/features/book/composables/useMetadataSearch', async () => {
  const { ref } = await import('vue')
  return {
    useMetadataSearch: () => ({
      providers: ref([{ key: 'fanqie' }, { key: 'qidian' }]),
      results: ref([]),
      isStreaming: ref(false),
      interruptedProviders: ref([]),
      loadProviders: vi.fn(),
      search: mocks.search,
      cancel: mocks.cancel,
      hasSearched: ref(false),
    }),
  }
})
import { sourceJobPercent, useFanqieAcquisition } from '../useFanqieAcquisition'
const candidate: MetadataCandidate = { provider: 'fanqie', providerId: '7290175791344651298', title: '测试小说', authors: ['作者'] }
const job: BookSourceJob = {
  id: 11,
  libraryId: 3,
  sourceBookId: candidate.providerId,
  title: '',
  status: 'queued',
  attempts: 0,
  retryable: true,
  cancelRequested: false,
  resultBookId: null,
  error: null,
  createdAt: '2026-10-23T00:00:00Z',
  updatedAt: '2026-10-23T00:00:00Z',
}
function harness() {
  let model!: ReturnType<typeof useFanqieAcquisition>
  const wrapper = mount(
    defineComponent({
      setup() {
        model = useFanqieAcquisition()
        return () => h('div')
      },
    }),
  )
  return { model, wrapper }
}

describe('Fanqie background acquisition', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.extraEditor = false
    mocks.hasPermission.mockReturnValue(true)
    mocks.api.mockImplementation((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url.endsWith('/status')
              ? { fanqie: { configured: true, format: 'epub' }, qidian: { configured: true, format: 'epub', scope: 'public-free-volumes' } }
              : url.includes('/jobs') && !url.endsWith('/cancel') && !url.endsWith('/retry')
                ? { items: [job], nextCursor: null }
                : job,
          ),
        ),
      ),
    )
  })
  it('submits a job with exact DTO fields and restores persistent tasks on load', async () => {
    const { model, wrapper } = harness()
    await model.load()
    expect(model.editableLibraries.value.map((l) => l.id)).toEqual([3])
    expect(model.jobs.value[0]?.status).toBe('queued')
    await model.acquire(candidate)
    const [url, request] = mocks.api.mock.calls.find(([url]) => url.includes('/sources/fanqie'))!
    expect(url).toBe('/api/v1/libraries/3/sources/fanqie')
    expect(request.method).toBe('POST')
    expect(JSON.parse(request.body)).toEqual({ bookId: candidate.providerId })
    expect(request.signal).toBeUndefined()
    expect(model.pendingId.value).toBeNull()
    wrapper.unmount()
    expect(mocks.api.mock.calls.some(([url]) => url.endsWith('/cancel'))).toBe(false)
  })
  it('searches only enabled download sources and refuses results from a disabled source', async () => {
    mocks.api.mockImplementation((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url.endsWith('/status')
              ? { fanqie: { configured: true, enabled: false }, qidian: { configured: true, enabled: true } }
              : { items: [], nextCursor: null },
          ),
        ),
      ),
    )
    const { model, wrapper } = harness()
    await model.load()
    model.title.value = '我在'
    await model.search()
    expect(mocks.search).toHaveBeenLastCalledWith(expect.objectContaining({ providers: ['qidian'] }))
    await model.acquire(candidate)
    expect(mocks.api).not.toHaveBeenCalledWith(expect.stringContaining('/sources/fanqie'), expect.anything())
    wrapper.unmount()
  })

  it('does not redownload an uncertain import before the explicit review confirmation', async () => {
    const { model, wrapper } = harness()
    await model.load()
    mocks.api.mockClear()
    model.reviewImport({ ...job, status: 'failed', retryable: false })
    expect(model.reviewingImport.value?.id).toBe(job.id)
    expect(mocks.api).not.toHaveBeenCalled()
    await model.confirmImportRetry()
    expect(mocks.api).toHaveBeenCalledWith(
      '/api/v1/book-sources/jobs/11/retry',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ confirmedImportNotCompleted: true }) }),
    )
    expect(model.reviewingImport.value).toBeNull()
    wrapper.unmount()
  })

  it('sends an explicit cancel instead of aborting the browser request', async () => {
    const { model, wrapper } = harness()
    await model.load()
    await model.cancel(job)
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/book-sources/jobs/11/cancel', { method: 'POST' })
    await model.retry({ ...job, status: 'failed' })
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/book-sources/jobs/11/retry', { method: 'POST' })
    wrapper.unmount()
  })
  it('does not submit or list private jobs without required permissions', async () => {
    mocks.hasPermission.mockReturnValue(false)
    const { model, wrapper } = harness()
    await model.load()
    await model.acquire(candidate)
    expect(mocks.api).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('preserves server submission errors and permits another submission', async () => {
    const { model, wrapper } = harness()
    await model.load()
    mocks.api.mockResolvedValueOnce(new Response(JSON.stringify({ message: '下载队列已满' }), { status: 409 }))
    await model.acquire(candidate)
    expect(model.error.value).toBe('下载队列已满')
    expect(model.pendingId.value).toBeNull()
    wrapper.unmount()
  })
  it('posts each candidate to its own source route without a source selector', async () => {
    const { model, wrapper } = harness()
    await model.load()
    await model.acquire(candidate)
    expect(mocks.api).toHaveBeenCalledWith(expect.stringContaining('/sources/fanqie'), expect.anything())
    await model.acquire({ ...candidate, provider: 'qidian', providerId: '1010868264' })
    expect(mocks.api).toHaveBeenCalledWith(
      '/api/v1/libraries/3/sources/qidian',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ bookId: '1010868264' }) }),
    )
    wrapper.unmount()
  })
  it('queues a refresh after cancellation when an older poll is still in flight', async () => {
    const { model, wrapper } = harness()
    await model.load()
    let resolvePoll!: (response: Response) => void
    mocks.api.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolvePoll = resolve
        }),
    )
    const poll = model.refreshJobs()
    const cancel = model.cancel(job)
    await vi.waitFor(() => expect(mocks.api).toHaveBeenCalledWith('/api/v1/book-sources/jobs/11/cancel', { method: 'POST' }))
    await Promise.resolve()
    mocks.api.mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ ...job, status: 'cancelled' }], nextCursor: null })))
    resolvePoll(new Response(JSON.stringify({ items: [job], nextCursor: null })))
    await Promise.all([poll, cancel])
    expect(model.jobs.value[0]?.status).toBe('cancelled')
    wrapper.unmount()
  })

  it('discards the old page response and fetches the requested cursor without a reload', async () => {
    const { model, wrapper } = harness()
    await model.load()
    model.nextCursor.value = 11
    let resolvePoll!: (response: Response) => void
    mocks.api.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolvePoll = resolve
        }),
    )
    const poll = model.refreshJobs()
    const page = model.nextPage()
    mocks.api.mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ ...job, id: 5 }], nextCursor: null })))
    resolvePoll(new Response(JSON.stringify({ items: [job], nextCursor: 11 })))
    await Promise.all([poll, page])
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/book-sources/jobs?cursor=11')
    expect(model.cursor.value).toBe(11)
    expect(model.jobs.value[0]?.id).toBe(5)
    wrapper.unmount()
  })

  it('does not offer retry for removed sources or an unavailable built-in downloader', async () => {
    const { model, wrapper } = harness()
    await model.load()
    expect(model.canRetry({ ...job, source: 'removed' })).toBe(false)
    model.customSources.value = [{ key: 'sample', label: 'Sample' }]
    expect(model.canRetry({ ...job, source: 'sample' })).toBe(true)
    expect(model.canRetry({ ...job, source: 'qidian' })).toBe(true)
    const api = mocks.api.getMockImplementation()!
    mocks.api.mockImplementation((url: string) =>
      url.endsWith('/status')
        ? Promise.resolve(new Response(JSON.stringify({ fanqie: { configured: false }, qidian: { configured: false } })))
        : api(url),
    )
    await model.load()
    expect(model.canRetry({ ...job, source: 'qidian' })).toBe(false)
    expect(model.canRetry(job)).toBe(false)
    wrapper.unmount()
  })
  it('preserves a valid library selection made while initial status loading is in flight', async () => {
    mocks.extraEditor = true
    const original = mocks.api.getMockImplementation()!
    let finishStatus!: (response: Response) => void
    mocks.api.mockImplementation((url: string) =>
      url.endsWith('/status')
        ? new Promise<Response>((resolve) => {
            finishStatus = resolve
          })
        : original(url),
    )
    const { model, wrapper } = harness()
    const loading = model.load()
    await vi.waitFor(() => expect(finishStatus).toBeTypeOf('function'))
    model.libraryId.value = 9
    finishStatus(new Response(JSON.stringify({ fanqie: { configured: true }, qidian: { configured: true } })))
    await loading
    expect(model.libraryId.value).toBe(9)
    wrapper.unmount()
  })
})

describe('download task language changes', () => {
  it('updates rendered task states without reloading or changing the task', async () => {
    await setI18nLocale('en')
    const { model, wrapper } = harness()
    let label = ''
    const stop = watchEffect(() => {
      label = model.statusLabel(job)
    })
    try {
      expect(label).toBe('Queued')
      await setI18nLocale('zh')
      await nextTick()
      expect(label).toBe('排队中')
      expect(job.status).toBe('queued')
    } finally {
      stop()
      wrapper.unmount()
      await setI18nLocale('en')
    }
  })
})

describe('novel source keyword browsing', () => {
  it('requests multiple partial-title results instead of single-book matching', async () => {
    const { model, wrapper } = harness()
    mocks.hasPermission.mockReturnValue(true)
    mocks.api.mockImplementation((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url.endsWith('/status')
              ? { fanqie: { configured: true, enabled: true }, qidian: { configured: true, enabled: true } }
              : { items: [], nextCursor: null },
          ),
        ),
      ),
    )
    await model.load()
    model.title.value = ' 我在 '
    await model.search()
    expect(mocks.search).toHaveBeenLastCalledWith(expect.objectContaining({ title: '我在', resultsPerProvider: 20, providers: ['fanqie', 'qidian'] }))
    wrapper.unmount()
  })
})

describe('task record deletion', () => {
  it('requires confirmation, keeps the result book, and refreshes the list after deletion', async () => {
    mocks.hasPermission.mockReturnValue(true)
    const { model, wrapper } = harness()
    const completed = { ...job, status: 'completed' as const, resultBookId: 31 }
    mocks.api.mockImplementation((_url: string, options?: { method: string }) =>
      Promise.resolve(new Response(JSON.stringify(options?.method === 'DELETE' ? completed : { items: [], nextCursor: null }))),
    )
    model.requestRemoval(completed)
    expect(mocks.api).not.toHaveBeenCalled()
    await model.confirmRemoval()
    expect(mocks.api).toHaveBeenCalledWith('/api/v1/book-sources/jobs/11', { method: 'DELETE' })
    expect(model.removingJob.value).toBeNull()
    expect(completed.resultBookId).toBe(31)
    expect(mocks.api.mock.calls.some(([url]) => url.includes('/books/'))).toBe(false)
    wrapper.unmount()
  })
  it('rejects running tasks, supports cancellation of the dialog and retains failed deletion for retry', async () => {
    mocks.hasPermission.mockReturnValue(true)
    const { model, wrapper } = harness()
    for (const status of ['queued', 'downloading', 'importing'] as const) model.requestRemoval({ ...job, status })
    expect(model.removingJob.value).toBeNull()
    const completed = { ...job, status: 'completed' as const }
    model.requestRemoval(completed)
    model.cancelRemoval()
    expect(model.removingJob.value).toBeNull()
    model.requestRemoval(completed)
    mocks.api.mockResolvedValueOnce(new Response('{"message":"Conflict"}', { status: 409 }))
    await model.confirmRemoval()
    expect(model.removingJob.value?.id).toBe(job.id)
    expect(model.error.value).toBeTruthy()
    wrapper.unmount()
  })
})

it('uses real chapter counts and never estimates unknown or invalid progress', () => {
  expect(sourceJobPercent({ ...job, progress: { phase: 'downloading', completedChapters: 25, totalChapters: 100 } })).toBe(25)
  expect(sourceJobPercent({ ...job, progress: { phase: 'preparing' } })).toBeUndefined()
  expect(sourceJobPercent({ ...job, progress: { phase: 'downloading', completedChapters: 101, totalChapters: 100 } })).toBeUndefined()
  expect(sourceJobPercent({ ...job, status: 'completed' })).toBe(100)
})
