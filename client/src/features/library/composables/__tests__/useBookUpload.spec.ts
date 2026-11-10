import { api } from '@/lib/api'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useBookUpload, SUPPORTED_FORMATS_ACCEPT } from '../useBookUpload'

vi.mock('@/lib/api', () => ({
  getValidToken: vi.fn<() => Promise<string>>().mockResolvedValue('test-token'),
  api: vi.fn<typeof import('@/lib/api').api>(),
}))
vi.mock('@/features/settings/composables/useAppInfo', () => ({ useAppInfo: () => ({ maxUploadSizeMb: ref(500) }) }))

describe('library DjVu upload', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.unstubAllGlobals())

  it('loads an owner-scoped review after the standard conflict response instead of treating it as a failed upload', async () => {
    const review = { id: 'review-1', filename: 'book.epub', matches: [] }
    vi.mocked(api).mockResolvedValue({ ok: true, json: async () => review } as Response)
    class ReviewXHR {
      status = 409
      responseText = JSON.stringify({ errorCode: 'IMPORT_REVIEW_REQUIRED', errorMeta: { reviewId: 'review-1' } })
      upload = {}
      onload: (() => void) | null = null
      open() {}
      setRequestHeader() {}
      send() {
        queueMicrotask(() => this.onload?.())
      }
    }
    vi.stubGlobal('XMLHttpRequest', ReviewXHR)
    const upload = useBookUpload()
    upload.addFiles([new File(['book content'], 'book.epub')])
    await upload.startUpload(3)
    expect(api).toHaveBeenCalledWith('/api/v1/imports/reviews/review-1')
    expect(upload.files.value[0]).toMatchObject({ status: 'review', progress: 100, review })
    expect(upload.errorCount.value).toBe(0)
    expect(upload.uploadedBookIds.value).toEqual([])
  })

  it('accepts DjVu in file selection and drag-and-drop validation regardless of case', () => {
    const upload = useBookUpload()
    upload.addFiles([new File(['document'], 'scanned-book.djvu'), new File(['document'], 'second.DJVU'), new File(['document'], 'notes.docx')])
    expect(SUPPORTED_FORMATS_ACCEPT.split(',')).toContain('.djvu')
    expect(upload.files.value.map((file) => [file.file.name, file.status])).toEqual([
      ['scanned-book.djvu', 'pending'],
      ['second.DJVU', 'pending'],
      ['notes.docx', 'error'],
    ])
    expect(upload.pendingCount.value).toBe(2)
  })
})
