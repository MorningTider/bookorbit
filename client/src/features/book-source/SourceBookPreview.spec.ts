import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { i18n, setI18nLocale } from '@/i18n'
import SourceBookPreview from './SourceBookPreview.vue'

describe('SourceBookPreview', () => {
  it('shows the full title, author and synopsis and supports expansion and failed covers', async () => {
    setI18nLocale('zh')
    const wrapper = mount(SourceBookPreview, {
      props: {
        book: {
          provider: 'fanqie',
          providerId: '6982529841564224526',
          title: '我在精神病院学斩神',
          authors: ['三九音域'],
          description: '完整简介',
          coverUrl: 'https://p6-novel.byteimg.com/cover.jpg',
        },
      },
      global: { plugins: [i18n] },
    })
    expect(wrapper.text()).toContain('我在精神病院学斩神')
    expect(wrapper.text()).toContain('三九音域')
    expect(wrapper.text()).toContain('完整简介')
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('false')
    await wrapper.get('button').trigger('click')
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('true')
    await wrapper.get('img').trigger('error')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('完整简介')
  })
})
