import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { DEFAULT_IMPORT_DUPLICATE_POLICY } from '@bookorbit/types'
import { i18n } from '@/i18n'
import ImportPolicySettings from './ImportPolicySettings.vue'
const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }))
vi.mock('@/features/auth/composables/usePermissions', () => ({ usePermissions: () => ({ hasPermission: () => true }) }))
function response(body: unknown) {
  return { ok: true, json: async () => body }
}
beforeEach(() => {
  apiMock.mockReset()
  apiMock.mockResolvedValue(response({ ...DEFAULT_IMPORT_DUPLICATE_POLICY }))
})
describe('duplicate import policy settings', () => {
  it('saves explicit global rules without silently changing other flags', async () => {
    const wrapper = mount(ImportPolicySettings, { props: { libraries: [{ id: 3, name: 'Ebooks' }] }, global: { plugins: [i18n] } })
    await flushPromises()
    await wrapper.get('[aria-labelledby="duplicate-policy-titleAndAuthor"]').trigger('click')
    await wrapper.get('button:not([role])').trigger('click')
    expect(apiMock).toHaveBeenLastCalledWith(
      '/api/v1/imports/policy',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ ...DEFAULT_IMPORT_DUPLICATE_POLICY, titleAndAuthor: false }) }),
    )
    wrapper.unmount()
  })
  it('keeps inherited library rules disabled and sends null to restore inheritance', async () => {
    const wrapper = mount(ImportPolicySettings, { props: { libraries: [{ id: 3, name: 'Ebooks' }] }, global: { plugins: [i18n] } })
    await flushPromises()
    apiMock.mockResolvedValueOnce(response({ global: DEFAULT_IMPORT_DUPLICATE_POLICY, override: null, effective: DEFAULT_IMPORT_DUPLICATE_POLICY }))
    await wrapper.get('select').setValue('3')
    await flushPromises()
    expect(wrapper.findAll('[role="switch"]').every((button) => button.attributes('disabled') !== undefined)).toBe(true)
    await wrapper.get('button:not([role])').trigger('click')
    expect(apiMock).toHaveBeenLastCalledWith(
      '/api/v1/imports/libraries/3/policy',
      expect.objectContaining({ method: 'PUT', body: '{"override":null}' }),
    )
    wrapper.unmount()
  })
})
