import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MetadataMatchCoverCard from './MetadataMatchCoverCard.vue'
import type { CoverChoice } from '../../composables/useMetadataDiff'

const choice: CoverChoice = {
  candidate: { provider: 'douban', providerId: 'example', title: 'Example', coverUrl: 'https://example.com/cover.jpg' },
  url: '/api/v1/books/cover/proxy?url=example',
  size: { width: 471, height: 665 },
  fit: 'match',
  broken: false,
}

function mountCover(active: CoverChoice | null = choice) {
  return mount(MetadataMatchCoverCard, {
    props: { label: 'Cover', medium: 'ebook', currentUrl: '', active, picked: null, choices: [], locked: false, providers: [] },
  })
}

describe('metadata selected cover and filtered alternatives', () => {
  it('does not report a visible cover as missing when the alternatives strip is empty', async () => {
    const wrapper = mountCover()
    expect(wrapper.findAll('img').some((image) => image.attributes('src') === choice.url)).toBe(true)
    expect(wrapper.text()).not.toContain('No cover in this result')
    await wrapper.setProps({ active: null })
    expect(wrapper.text()).toContain('No cover in this result')
    wrapper.unmount()
  })
})
