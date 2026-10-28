import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { setI18nLocale } from '@/i18n'
import LibraryMetadataCompletenessHeatmapChart from './LibraryMetadataCompletenessHeatmapChart.vue'

vi.mock('../../composables/useLibraryMetadataCompleteness', () => ({
  useLibraryMetadataCompleteness: () => ({
    data: ref({ items: [{ libraryName: 'Test Library', field: 'Page Count', percent: 50, presentCount: 1, totalCount: 2 }] }),
    loading: ref(false),
    error: ref(null),
  }),
}))
vi.mock('@/composables/useChartTokens', () => ({ useChartTokens: () => ref({ key: 'test', dark: false, color: () => '#000000' }) }))
vi.mock('@/lib/heatmap-palette', () => ({ buildHeatmapPalette: () => ({ scale: ['#fff', '#ddd', '#bbb', '#999', '#777'] }) }))
vi.mock('vue-echarts', () => ({ default: { name: 'VChartStub', props: ['option'], template: '<div />' } }))

describe('localized metadata heatmap', () => {
  afterEach(async () => {
    await setI18nLocale('en')
  })
  it('updates axis and tooltip labels after switching language without remounting', async () => {
    await setI18nLocale('en')
    const wrapper = mount(LibraryMetadataCompletenessHeatmapChart, {
      global: { stubs: { ChartCard: { template: '<div><slot /></div>' } } },
    })
    type Option = { xAxis: { data: string[] }; tooltip: { formatter: (value: { value: number[] }) => string }; series: { data: number[][] }[] }
    const option = () => wrapper.findComponent({ name: 'VChartStub' }).props('option') as Option
    expect(option().xAxis.data).toEqual(['Page Count'])
    const originalPoints = structuredClone(option().series[0]!.data)
    await setI18nLocale('zh')
    await nextTick()
    expect(option().xAxis.data).toEqual(['页数'])
    expect(option().tooltip.formatter({ value: [0, 0, 50, 1, 2] })).toContain('页数:')
    expect(option().tooltip.formatter({ value: [0, 0, 50, 1, 2] })).not.toContain('Page Count')
    expect(option().series[0]!.data).toEqual(originalPoints)
    wrapper.unmount()
  })
})
