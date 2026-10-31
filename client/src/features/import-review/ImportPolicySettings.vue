<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ImportDuplicatePolicy, ImportPolicyResponse } from '@bookorbit/types'
import { DEFAULT_IMPORT_DUPLICATE_POLICY } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { usePermissions } from '@/features/auth/composables/usePermissions'
const props = defineProps<{ libraries: { id: number; name: string }[] }>()
const { t } = useI18n()
const { hasPermission } = usePermissions()
const scope = ref('global')
const policy = ref<ImportDuplicatePolicy>({ ...DEFAULT_IMPORT_DUPLICATE_POLICY })
const inherit = ref(true)
const busy = ref(false)
const notice = ref('')
const keys = Object.keys(DEFAULT_IMPORT_DUPLICATE_POLICY) as (keyof ImportDuplicatePolicy)[]
const canGlobal = computed(() => hasPermission('manage_app_settings'))
const endpoint = computed(() => (scope.value === 'global' ? '/api/v1/imports/policy' : `/api/v1/imports/libraries/${scope.value}/policy`))
const disabled = computed(() => busy.value || (scope.value !== 'global' && inherit.value))
let sequence = 0
async function load() {
  const current = ++sequence
  if (scope.value === 'global' && !canGlobal.value) return
  busy.value = true
  notice.value = ''
  try {
    const response = await api(endpoint.value)
    if (!response.ok) throw new Error()
    const data = (await response.json()) as ImportDuplicatePolicy | ImportPolicyResponse
    if (current !== sequence) return
    if ('effective' in data) {
      policy.value = { ...data.effective }
      inherit.value = data.override === null
    } else policy.value = { ...data }
  } catch {
    if (current === sequence) notice.value = t('importReview.policy.failed')
  } finally {
    if (current === sequence) busy.value = false
  }
}
function toggle(key: keyof ImportDuplicatePolicy) {
  if (!disabled.value) policy.value[key] = !policy.value[key]
}
async function save() {
  if (busy.value) return
  busy.value = true
  notice.value = ''
  try {
    const response = await api(endpoint.value, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scope.value === 'global' ? policy.value : { override: inherit.value ? null : policy.value }),
    })
    if (!response.ok) throw new Error()
    notice.value = t('importReview.policy.saved')
  } catch {
    notice.value = t('importReview.policy.failed')
  } finally {
    busy.value = false
  }
}
watch(
  () => props.libraries,
  (libraries) => {
    if (!canGlobal.value && scope.value === 'global' && libraries[0]) scope.value = String(libraries[0].id)
  },
  { immediate: true },
)
watch(scope, load, { immediate: true })
</script>
<template>
  <section class="space-y-4 rounded-lg border border-border bg-card p-4">
    <h2 class="font-semibold">{{ t('importReview.policy.title') }}</h2>
    <p class="text-sm text-muted-foreground">{{ t('importReview.policy.description') }}</p>
    <select
      v-model="scope"
      :disabled="busy"
      :aria-label="t('importReview.policy.title')"
      class="w-full rounded-md border border-input bg-background p-2 sm:max-w-sm"
    >
      <option v-if="canGlobal" value="global">{{ t('importReview.policy.global') }}</option>
      <option v-for="library in libraries" :key="library.id" :value="String(library.id)">{{ library.name }}</option>
    </select>
    <label v-if="scope !== 'global'" class="flex items-center gap-2 text-sm"
      ><input v-model="inherit" type="checkbox" :disabled="busy" class="accent-primary" />{{ t('importReview.policy.inherit') }}</label
    >
    <div class="divide-y divide-border">
      <div v-for="key in keys" :key="key" class="flex items-center justify-between gap-4 py-3">
        <span :id="`duplicate-policy-${key}`" class="text-sm">{{ t(`importReview.policy.${key}`) }}</span>
        <button
          type="button"
          role="switch"
          :aria-checked="policy[key]"
          :aria-labelledby="`duplicate-policy-${key}`"
          :disabled="disabled"
          class="relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50"
          :class="policy[key] ? 'bg-primary' : 'bg-muted-foreground/30'"
          @click="toggle(key)"
        >
          <span
            class="absolute top-0.5 h-4 w-4 rounded-full bg-primary-foreground transition-transform"
            :class="policy[key] ? 'left-0 translate-x-4.5' : 'left-0 translate-x-0.5'"
          />
        </button>
      </div>
    </div>
    <p v-if="notice" role="status" class="text-sm">{{ notice }}</p>
    <Button :disabled="busy || (scope === 'global' && !canGlobal)" @click="save">{{ t('importReview.policy.save') }}</Button>
  </section>
</template>
