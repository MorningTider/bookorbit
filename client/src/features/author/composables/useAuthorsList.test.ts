import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { fetchAuthors } from '../api/author'
import { useAuthorsList } from './useAuthorsList'
vi.mock('../api/author', () => ({ fetchAuthors: vi.fn<(...args: unknown[]) => Promise<unknown>>() }))
const author = { id: 7, name: 'Author', sortName: null, description: null, bookCount: 1, lastAddedAt: null, coverBookId: null, imageUrl: null }
beforeEach(() => {
  vi.resetAllMocks()
})
describe('author background portrait updates', () => {
  it('patches loaded cards in place without another list request', async () => {
    vi.mocked(fetchAuthors).mockResolvedValue({ items: [author], total: 1, page: 0, size: 50 })
    const list = useAuthorsList()
    await list.load(true)
    list.applyPhotoUpdate({ authorId: 7, version: 123 })
    expect(list.items.value[0]?.imageUrl).toBe('/api/v1/authors/7/thumbnail?t=123')
    expect(list.items.value[0]?.name).toBe('Author')
    list.applyPhotoUpdate({ authorId: 99, version: 456 })
    expect(fetchAuthors).toHaveBeenCalledTimes(1)
  })
  it('repeats a reset requested while an earlier list request was in flight', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof fetchAuthors>>) => void
    vi.mocked(fetchAuthors).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )
    vi.mocked(fetchAuthors).mockResolvedValue({ items: [], total: 0, page: 0, size: 50 })
    const list = useAuthorsList()
    const initial = list.load(true)
    await list.load(true)
    resolve({ items: [author], total: 1, page: 0, size: 50 })
    await initial
    await flushPromises()
    expect(fetchAuthors).toHaveBeenCalledTimes(2)
    expect(list.items.value).toEqual([])
  })
})
