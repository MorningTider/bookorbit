import { effectScope, nextTick, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { useEpubTocOrganization } from './useEpubTocOrganization'

vi.mock('@/lib/api', () => ({ api: vi.fn<typeof import('@/lib/api').api>() }))
const apiMock = vi.mocked(api)
const state = {
  bookId: 7,
  fileId: 11,
  sha256: 'a'.repeat(64),
  entries: ['引言', '目录', '甲集', '第二章', '乙集', '第二章'].map((label, index) => ({ label, href: `${index}.xhtml` })),
  suggestedGroups: [
    { index: 2, label: '甲集' },
    { index: 4, label: '乙集' },
  ],
  suggestionSource: 'contents',
}
const response = () => new Response(JSON.stringify(state))
let scope = effectScope()
beforeEach(() => {
  scope = effectScope()
  apiMock.mockReset()
  apiMock.mockResolvedValue(response())
})
afterEach(() => scope.stop())

describe('EPUB directory editor', () => {
  it('loads suggested groups, filters large entry lists and previews their sizes', async () => {
    const editor = scope.run(() => useEpubTocOrganization(ref(7), ref(11)))!
    await flushPromises()
    expect(editor.groups.value).toEqual(state.suggestedGroups)
    expect(editor.preview.value.map((item) => item.count)).toEqual([2, 2])
    expect(editor.changed.value).toBe(true)
    editor.query.value = '乙集'
    expect(editor.filteredRows.value).toEqual([{ index: 4, label: '乙集' }])
  })
  it('allows manual boundaries and names while keeping invalid labels unsaveable', async () => {
    const editor = scope.run(() => useEpubTocOrganization(ref(7), ref(11)))!
    await flushPromises()
    editor.clear()
    expect(editor.groups.value).toEqual([])
    editor.toggle(2)
    editor.toggle(4)
    editor.rename(2, '上册')
    expect(editor.groups.value).toEqual([
      { index: 2, label: '上册' },
      { index: 4, label: '乙集' },
    ])
    editor.rename(2, '')
    expect(editor.changed.value).toBe(false)
    expect(await editor.save()).toBeNull()
    editor.suggest()
    expect(editor.groups.value).toEqual(state.suggestedGroups)
  })
  it('posts JSON with the exact original version and keeps choices after a failed write', async () => {
    const editor = scope.run(() => useEpubTocOrganization(ref(7), ref(11)))!
    await flushPromises()
    apiMock.mockResolvedValueOnce(new Response(null, { status: 503 }))
    expect(await editor.save()).toBeNull()
    expect(editor.error.value).toBe('saveFailed')
    expect(editor.groups.value).toEqual(state.suggestedGroups)
    const [path, init] = apiMock.mock.lastCall!
    expect(path).toBe('/api/v1/books/7/files/11/toc/organize')
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json')
    expect(JSON.parse(String(init?.body))).toEqual({ expectedSha256: state.sha256, groups: state.suggestedGroups })
    apiMock.mockResolvedValueOnce(new Response(JSON.stringify({ bookId: 7, fileId: 11, changed: true, groupCount: 2 })))
    await expect(editor.save()).resolves.toMatchObject({ changed: true })
  })
  it('shows stale-file conflicts and reloads the current version explicitly', async () => {
    const editor = scope.run(() => useEpubTocOrganization(ref(7), ref(11)))!
    await flushPromises()
    apiMock.mockResolvedValueOnce(new Response(null, { status: 409 }))
    await editor.save()
    expect(editor.error.value).toBe('stale')
    apiMock.mockResolvedValueOnce(new Response(JSON.stringify({ ...state, sha256: 'b'.repeat(64) })))
    await editor.load()
    expect(editor.state.value?.sha256).toBe('b'.repeat(64))
    expect(editor.error.value).toBeNull()
  })
  it('drops a previous file response and clears previous selections when the target changes', async () => {
    let complete!: (response: Response) => void
    apiMock.mockReturnValueOnce(
      new Promise((resolve) => {
        complete = resolve
      }),
    )
    const fileId = ref(11)
    const editor = scope.run(() => useEpubTocOrganization(ref(7), fileId))!
    apiMock.mockResolvedValueOnce(new Response(null, { status: 500 }))
    fileId.value = 12
    await nextTick()
    await flushPromises()
    complete(response())
    await flushPromises()
    expect(editor.state.value).toBeNull()
    expect(editor.groups.value).toEqual([])
    expect(editor.error.value).toBe('loadFailed')
  })
  it('recognizes an already grouped directory as unchanged', async () => {
    apiMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...state,
          entries: [{ label: '甲集', href: 'a', children: [{ label: '第二章', href: 'b' }] }],
          suggestedGroups: [{ index: 0, label: '甲集' }],
        }),
      ),
    )
    const editor = scope.run(() => useEpubTocOrganization(ref(7), ref(11)))!
    await flushPromises()
    expect(editor.changed.value).toBe(false)
    expect(await editor.save()).toBeNull()
  })
})
