import { defineComponent, h, nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'
import { useGithubSourceConfig } from '../useGithubSourceConfig'
vi.mock('@/lib/api', () => ({ api: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>() }))
const config = {
  revision: 'revision-1',
  enabled: false,
  repositories: [
    {
      id: 1,
      label: '测试',
      repository: 'owner/books',
      branch: '',
      path: '',
      formats: ['epub'],
      enabled: true,
      indexState: 'ready',
      fileCount: 10,
      indexedAt: null,
      error: null,
    },
  ],
}
function harness() {
  let model!: ReturnType<typeof useGithubSourceConfig>
  const wrapper = mount(
    defineComponent({
      setup() {
        model = useGithubSourceConfig()
        return () => h('div')
      },
    }),
  )
  return { model, wrapper }
}
describe('GitHub source configuration', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(api).mockImplementation(async () => new Response(JSON.stringify(config)))
  })
  it('loads a separate source switch and emits only editable configuration fields', async () => {
    const { model, wrapper } = harness()
    await flushPromises()
    model.toggle()
    await nextTick()
    expect(model.dirty.value).toBe(true)
    expect(await model.save()).toBe(true)
    const call = vi.mocked(api).mock.calls.find(([, init]) => init?.method === 'PUT')!
    const body = JSON.parse(call[1]!.body as string)
    expect(body.enabled).toBe(true)
    expect(body.repositories[0].indexState).toBeUndefined()
    expect(body.repositories[0].fileCount).toBeUndefined()
    wrapper.unmount()
  })
  it('retains the draft after a rejected save', async () => {
    const { model, wrapper } = harness()
    await flushPromises()
    model.toggle()
    await nextTick()
    vi.mocked(api).mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Configuration changed' }), { status: 409 }))
    expect(await model.save()).toBe(false)
    expect(model.draft.value?.enabled).toBe(true)
    expect(model.dirty.value).toBe(true)
    wrapper.unmount()
  })
  it('requires saving an edited repository before testing or indexing it', async () => {
    const { model, wrapper } = harness()
    await flushPromises()
    model.draft.value!.repositories[0]!.path = 'changed'
    await nextTick()
    await model.refresh(model.draft.value!.repositories[0]!)
    expect(vi.mocked(api).mock.calls.some(([url]) => String(url).includes('/refresh'))).toBe(false)
    wrapper.unmount()
  })
})
