import { setI18nLocale } from '@/i18n'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePublicChapterRules } from '../usePublicChapterRules'
const mocks = vi.hoisted(() => ({ api: vi.fn<typeof import('@/lib/api').api>() }))
vi.mock('@/lib/api', () => ({ api: mocks.api }))
beforeEach(() => {
  vi.resetAllMocks()
  mocks.api.mockImplementation(() => Promise.resolve(new Response('{"sources":[]}')))
})
describe('chapter rules operation boundaries', () => {
  it('measures the UTF-8 request size instead of JavaScript character count', async () => {
    const model = usePublicChapterRules()
    await model.load()
    model.text.value = JSON.stringify({ sources: ['中'.repeat(90000)] })
    expect(model.text.value.length).toBeLessThan(256 * 1024)
    expect(await model.save()).toBe(false)
    expect(mocks.api).toHaveBeenCalledTimes(1)
    expect(model.error.value).toContain('256 KiB')
  })
  it('blocks saving until an imported file has finished reading', async () => {
    const model = usePublicChapterRules()
    await model.load()
    let finish!: (text: string) => void
    const file = {
      size: 20,
      text: () =>
        new Promise<string>((resolve) => {
          finish = resolve
        }),
    } as File
    const reading = model.importFile(file)
    expect(model.busy.value).toBe(true)
    expect(await model.save()).toBe(false)
    expect(mocks.api).toHaveBeenCalledTimes(1)
    finish('{"sources":[]}')
    await reading
    expect(model.busy.value).toBe(false)
    expect(await model.save()).toBe(true)
    expect(mocks.api).toHaveBeenCalledTimes(2)
  })
  it('preserves server rules when initial loading fails', async () => {
    mocks.api.mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
    const model = usePublicChapterRules()
    await model.load()
    expect(model.loaded.value).toBe(false)
    expect(await model.save()).toBe(false)
    expect(mocks.api).toHaveBeenCalledTimes(1)
    await model.load()
    expect(model.loaded.value).toBe(true)
  })
})

it('shows a localized invalid-JSON error and never submits malformed rules', async () => {
  await setI18nLocale('zh')
  try {
    const model = usePublicChapterRules()
    await model.load()
    model.text.value = '{invalid json'
    expect(await model.save()).toBe(false)
    expect(model.error.value).toBe('章节规则文件不是有效JSON')
    expect(mocks.api).toHaveBeenCalledTimes(1)
  } finally {
    await setI18nLocale('en')
  }
})

it.each([
  { failure: new TypeError('Failed to fetch'), expected: '无法连接服务器，请检查网络后重试。' },
  {
    failure: new Response(JSON.stringify({ message: 'Service Unavailable' }), { status: 503 }),
    expected: '书源服务请求失败（HTTP 503），请稍后重试。',
  },
])('localizes source failures without allowing an empty overwrite', async ({ failure, expected }) => {
  await setI18nLocale('zh')
  try {
    if (failure instanceof Error) mocks.api.mockRejectedValueOnce(failure)
    else mocks.api.mockResolvedValueOnce(failure)
    const model = usePublicChapterRules()
    await model.load()
    expect(model.error.value).toBe(expected)
    expect(model.loaded.value).toBe(false)
    expect(await model.save()).toBe(false)
    await model.load()
    expect(model.loaded.value).toBe(true)
  } finally {
    await setI18nLocale('en')
  }
})
