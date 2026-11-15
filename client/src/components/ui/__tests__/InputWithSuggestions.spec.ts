import { mount } from '@vue/test-utils'
import { defineComponent, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import InputWithSuggestions from '../InputWithSuggestions.vue'

function mountHost(initialValue: string | null, searchFn: (query: string) => Promise<string[]>, formatValue?: (value: string) => string) {
  const Host = defineComponent({
    components: { InputWithSuggestions },
    setup() {
      const model = ref<string | null>(initialValue)
      return { model, searchFn, formatValue }
    },
    template: '<InputWithSuggestions v-model="model" :search-fn="searchFn" :format-value="formatValue" />',
  })

  return mount(Host, {
    global: {
      stubs: {
        teleport: true,
      },
    },
  })
}

describe('InputWithSuggestions', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not fetch suggestions on programmatic model updates', async () => {
    const searchFn = vi.fn<(query: string) => Promise<string[]>>().mockResolvedValue(['English'])
    const wrapper = mountHost(null, searchFn)

    ;(wrapper.vm as { model: string | null }).model = 'English'
    await nextTick()
    await vi.advanceTimersByTimeAsync(250)

    expect(searchFn).not.toHaveBeenCalled()
    expect(wrapper.findAll('button')).toHaveLength(0)
  })

  it('fetches suggestions after user typing in a focused input', async () => {
    const searchFn = vi.fn<(query: string) => Promise<string[]>>().mockResolvedValue(['English', 'French'])
    const wrapper = mountHost(null, searchFn)
    const input = wrapper.get('input')

    await input.trigger('focus')
    await input.setValue('En')
    await vi.advanceTimersByTimeAsync(250)
    await nextTick()

    expect(searchFn).toHaveBeenCalledWith('En')
    expect(wrapper.findAll('button')).toHaveLength(2)
  })

  it('cancels pending lookup when value is replaced programmatically', async () => {
    const searchFn = vi.fn<(query: string) => Promise<string[]>>().mockResolvedValue(['English'])
    const wrapper = mountHost(null, searchFn)
    const input = wrapper.get('input')

    await input.trigger('focus')
    await input.setValue('En')
    ;(wrapper.vm as { model: string | null }).model = 'French'
    await nextTick()
    await vi.advanceTimersByTimeAsync(250)

    expect(searchFn).not.toHaveBeenCalled()
    expect(wrapper.findAll('button')).toHaveLength(0)
  })
  it('shows a localized value while preserving the code through focus and blur', async () => {
    const wrapper = mountHost('zh-Hans', vi.fn().mockResolvedValue([]), (value) => (value === 'zh-Hans' ? '简体中文' : value))
    const input = wrapper.get('input')
    expect(input.element.value).toBe('简体中文')
    await input.trigger('focus')
    expect(input.element.value).toBe('zh-Hans')
    await input.trigger('blur')
    expect(input.element.value).toBe('简体中文')
    expect((wrapper.vm as { model: string }).model).toBe('zh-Hans')
  })
  it('shows localized suggestion labels and selects their original values', async () => {
    const wrapper = mountHost(null, vi.fn().mockResolvedValue(['zh-Hans']), (value) => (value === 'zh-Hans' ? '简体中文' : value))
    const input = wrapper.get('input')
    await input.trigger('focus')
    await input.setValue('简体')
    await vi.advanceTimersByTimeAsync(250)
    await nextTick()
    expect(wrapper.get('button').text()).toBe('简体中文')
    await wrapper.get('button').trigger('mousedown')
    expect((wrapper.vm as { model: string }).model).toBe('zh-Hans')
  })
})
