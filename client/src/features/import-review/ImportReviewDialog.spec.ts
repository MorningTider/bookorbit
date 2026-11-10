import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { ImportReviewResponse } from '@bookorbit/types'
import { i18n } from '@/i18n'
import ImportReviewDialog from './ImportReviewDialog.vue'
const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn<typeof import('@/lib/api').api>() }))
vi.mock('@/lib/api', () => ({ api: (...args: Parameters<typeof import('@/lib/api').api>) => apiMock(...args) }))
const review: ImportReviewResponse = {
  id: 'review-1',
  libraryId: 3,
  filename: 'book.epub',
  format: 'epub',
  sizeBytes: 4,
  expiresAt: '2026-11-01T00:00:00Z',
  matches: [
    {
      bookId: 12,
      libraryId: 3,
      libraryName: 'Ebooks',
      title: 'Book',
      authors: ['Author'],
      mediaKind: 'ebook',
      exact: true,
      canEdit: true,
      reasons: ['source_identity'],
      files: [{ id: 30, filename: 'book.epub', format: 'epub', sizeBytes: 4, updatedAt: '2026-10-31T00:00:00Z' }],
    },
  ],
}
const mounted: ReturnType<typeof mount>[] = []
function setup(value = review) {
  const wrapper = mount(ImportReviewDialog, {
    attachTo: document.body,
    props: { review: value },
    global: { plugins: [i18n], stubs: { DialogPortal: { template: '<div><slot /></div>' } } },
  })
  mounted.push(wrapper)
  return wrapper
}
beforeEach(() => {
  apiMock.mockReset()
  apiMock.mockImplementation(async (url) =>
    Response.json(
      String(url).includes('/version') ? { fileId: 30, bookId: 12, sha256: 'a'.repeat(64) } : { items: review.matches[0]!.files, nextCursor: null },
    ),
  )
})
afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount())
  document.body.innerHTML = ''
})
describe('duplicate import decision dialog', () => {
  it('requires an explicit choice and attaches to the selected book without requesting an overwrite token', async () => {
    const wrapper = setup()
    await flushPromises()
    expect(wrapper.findAll('button').at(-1)!.attributes('disabled')).toBeDefined()
    expect(wrapper.emitted('confirm')).toBeUndefined()
    await wrapper.get('input[value="attach"]').setValue(true)
    await wrapper.findAll('button').at(-1)!.trigger('click')
    expect(wrapper.emitted('confirm')).toEqual([[{ action: 'attach', bookId: 12 }]])
    expect(apiMock).not.toHaveBeenCalled()
  })
  it('verifies the current file and includes its full hash in a replacement confirmation', async () => {
    const wrapper = setup()
    await flushPromises()
    await wrapper.get('input[value="replace"]').setValue(true)
    await flushPromises()
    await wrapper.findAll('button').at(-1)!.trigger('click')
    await flushPromises()
    expect(apiMock).toHaveBeenCalledWith('/api/v1/imports/files/30/version')
    expect(wrapper.emitted('confirm')).toEqual([[{ action: 'replace', bookId: 12, fileId: 30, expectedSha256: 'a'.repeat(64) }]])
  })
  it('shows read-only matches while offering only creation of a separate book', async () => {
    const wrapper = setup({ ...review, matches: review.matches.map((match) => ({ ...match, canEdit: false })) })
    await flushPromises()
    expect(wrapper.text()).toContain('Book')
    expect(wrapper.find('input[value="replace"]').exists()).toBe(false)
    expect(wrapper.find('input[value="attach"]').exists()).toBe(false)
    await wrapper.get('input[value="new"]').setValue(true)
    await wrapper.findAll('button').at(-1)!.trigger('click')
    expect(wrapper.emitted('confirm')).toEqual([[{ action: 'new' }]])
  })
})
