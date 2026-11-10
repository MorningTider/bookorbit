import { effectScope, nextTick, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { useBookComments } from './useBookComments'

vi.mock('@/lib/api', () => ({ api: vi.fn<typeof import('@/lib/api').api>() }))
const apiMock = vi.mocked(api)
const response = (items: unknown[] = [], nextCursor: number | null = null) => new Response(JSON.stringify({ items, nextCursor }))
const comment = { id: 1, authorName: 'Another reader', body: 'A review', scope: 'review' } as never
let scope = effectScope()
afterEach(() => {
  scope.stop()
})
beforeEach(() => {
  scope = effectScope()
  apiMock.mockReset()
  apiMock.mockResolvedValue(response())
})

describe('shared book comment interaction', () => {
  it('loads server-visible rows and paginates using a cursor', async () => {
    apiMock.mockResolvedValueOnce(response([comment], 1))
    const state = scope.run(() => useBookComments(ref(7)))!
    await flushPromises()
    expect(state.items.value).toEqual([comment])
    apiMock.mockResolvedValueOnce(response([{ id: 2 }]))
    await state.load(true)
    expect(apiMock.mock.lastCall?.[0]).toContain('before=1')
    expect(state.items.value.map((row) => row.id)).toEqual([1, 2])
  })
  it('retains the draft and request id on a failed submission, then replies to the chosen user', async () => {
    const state = scope.run(() => useBookComments(ref(7)))!
    await flushPromises()
    state.replyTo(comment)
    state.draft.value = 'A reply'
    await nextTick()
    apiMock.mockResolvedValueOnce(new Response('', { status: 503 }))
    await state.send()
    const first = JSON.parse(String(apiMock.mock.lastCall?.[1]?.body))
    expect(state.error.value).toBe(true)
    expect(state.draft.value).toBe('A reply')
    apiMock.mockResolvedValueOnce(new Response('{}', { status: 201 })).mockResolvedValueOnce(response())
    await state.send()
    const writes = apiMock.mock.calls.filter((call) => call[1]?.method === 'POST')
    expect(JSON.parse(String(writes[1][1]?.body))).toEqual(first)
    expect(first.parentId).toBe(1)
    expect(state.draft.value).toBe('')
  })
  it('ignores a late response after navigation to another book', async () => {
    let resolve!: (response: Response) => void
    apiMock.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done
      }),
    )
    const id = ref(7)
    const state = scope.run(() => useBookComments(id))!
    id.value = 8
    apiMock.mockResolvedValueOnce(response([{ id: 8 }]))
    await nextTick()
    await flushPromises()
    resolve(response([{ id: 7 }]))
    await flushPromises()
    expect(state.items.value.map((row) => row.id)).toEqual([8])
  })
  it('keeps replies in the selected root thread and deletes via the authenticated API', async () => {
    const state = scope.run(() => useBookComments(ref(7)))!
    await flushPromises()
    state.openThread(comment)
    await flushPromises()
    expect(apiMock.mock.lastCall?.[0]).toContain('threadId=1')
    apiMock.mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(response())
    await state.remove(comment)
    expect(apiMock.mock.calls.some((call) => call[0] === '/api/v1/books/7/comments/1/own' && call[1]?.method === 'DELETE')).toBe(true)
  })
})
