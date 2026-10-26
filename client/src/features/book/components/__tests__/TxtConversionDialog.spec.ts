import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import TxtConversionDialog from '../TxtConversionDialog.vue'

const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: mocks.api }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const global = {
  stubs: Object.fromEntries(
    ['DialogRoot', 'DialogPortal', 'DialogContent', 'DialogTitle', 'DialogDescription', 'DialogOverlay'].map((name) => [
      name,
      { template: '<div><slot /></div>' },
    ]),
  ),
}

beforeEach(() => vi.resetAllMocks())
describe('TXT conversion dialog', () => {
  it('sends the selected encoding and chapters and only reports completion after success', async () => {
    const wrapper = mount(TxtConversionDialog, { props: { bookId: 20, open: true }, global })
    const selects = wrapper.findAll('select')
    await selects[0]!.setValue('gb18030')
    await selects[1]!.setValue('chinese')
    mocks.api.mockResolvedValueOnce(new Response('{}'))
    await wrapper.findAll('button')[1]!.trigger('click')
    await flushPromises()
    expect(mocks.api).toHaveBeenCalledWith(
      '/api/v1/books/20/convert-txt-to-epub',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ encoding: 'gb18030', chapters: 'chinese' }),
      }),
    )
    expect(wrapper.emitted('completed')).toHaveLength(1)
    wrapper.unmount()
  })

  it('shows decoding errors and allows retry with a corrected encoding', async () => {
    const wrapper = mount(TxtConversionDialog, { props: { bookId: 20, open: true }, global })
    mocks.api.mockResolvedValueOnce(new Response('{"message":"Invalid UTF-8"}', { status: 400 }))
    await wrapper.findAll('button')[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toBe('Invalid UTF-8')
    expect(wrapper.emitted('completed')).toBeUndefined()
    await wrapper.findAll('select')[0]!.setValue('gb18030')
    mocks.api.mockResolvedValueOnce(new Response('{}'))
    await wrapper.findAll('button')[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.emitted('completed')).toHaveLength(1)
    wrapper.unmount()
  })

  it('prevents duplicate conversions and disables closing while the request is pending', async () => {
    let finish!: (response: Response) => void
    mocks.api.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
    )
    const wrapper = mount(TxtConversionDialog, { props: { bookId: 20, open: true }, global })
    await wrapper.findAll('button')[1]!.trigger('click')
    expect(wrapper.findAll('button').every((button) => button.attributes('disabled') !== undefined)).toBe(true)
    await wrapper.findAll('button')[1]!.trigger('click')
    expect(mocks.api).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('update:open')).toBeUndefined()
    finish(new Response('{}'))
    await flushPromises()
    expect(wrapper.emitted('completed')).toHaveLength(1)
    wrapper.unmount()
  })
})
