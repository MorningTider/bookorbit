import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import {
  groupEpubTocEntries,
  EPUB_TOC_GROUP_LABEL_PATTERN,
  type EpubTocGroupStart,
  type EpubTocItem,
  type EpubTocOrganization,
  type OrganizeEpubTocResult,
} from '@bookorbit/types'
import { api } from '@/lib/api'

function entryCount(entry: EpubTocItem): number {
  return 1 + (entry.children ?? []).reduce((total, child) => total + entryCount(child), 0)
}

export function useEpubTocOrganization(bookId: Ref<number>, fileId: Ref<number>) {
  const state = ref<EpubTocOrganization | null>(null)
  const groups = ref<EpubTocGroupStart[]>([])
  const query = ref('')
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<'loadFailed' | 'saveFailed' | 'stale' | null>(null)
  let generation = 0
  onScopeDispose(() => generation++)
  const selected = computed(() => new Map(groups.value.map((group) => [group.index, group.label])))
  const rows = computed(() => (state.value?.entries ?? []).map((entry, index) => ({ index, label: entry.label })))
  const filteredRows = computed(() => {
    const text = query.value.trim().toLocaleLowerCase()
    return text
      ? rows.value.filter((row) => row.label.toLocaleLowerCase().includes(text) || selected.value.get(row.index)?.toLocaleLowerCase().includes(text))
      : rows.value
  })
  const valid = computed(
    () =>
      groups.value.length > 0 &&
      groups.value.every(
        (group) => group.label.trim().length > 0 && group.label.trim().length <= 500 && EPUB_TOC_GROUP_LABEL_PATTERN.test(group.label),
      ),
  )
  const changed = computed(
    () =>
      valid.value &&
      state.value !== null &&
      JSON.stringify(groupEpubTocEntries(state.value.entries, groups.value)) !== JSON.stringify(state.value.entries),
  )
  const prefixCounts = computed(() => {
    const totals = [0]
    for (const entry of state.value?.entries ?? []) totals.push(totals[totals.length - 1]! + entryCount(entry))
    return totals
  })
  const preview = computed(() =>
    groups.value.map((group, index) => ({
      ...group,
      count: prefixCounts.value[groups.value[index + 1]?.index ?? rows.value.length]! - prefixCounts.value[group.index]!,
    })),
  )

  async function load() {
    const current = ++generation
    const path = `/api/v1/books/${bookId.value}/files/${fileId.value}/toc`
    loading.value = true
    error.value = null
    try {
      const response = await api(path)
      if (!response.ok) throw new Error('Directory request failed')
      const value: EpubTocOrganization = await response.json()
      if (current !== generation) return
      state.value = value
      groups.value = value.suggestedGroups.map((group) => ({ ...group }))
    } catch {
      if (current === generation) error.value = 'loadFailed'
    } finally {
      if (current === generation) loading.value = false
    }
  }
  function suggest() {
    groups.value = state.value?.suggestedGroups.map((group) => ({ ...group })) ?? []
  }
  function clear() {
    groups.value = []
  }
  function toggle(index: number) {
    if (saving.value) return
    groups.value = selected.value.has(index)
      ? groups.value.filter((group) => group.index !== index)
      : [...groups.value, { index, label: state.value!.entries[index]!.label }].sort((a, b) => a.index - b.index)
  }
  function rename(index: number, label: string) {
    if (saving.value) return
    groups.value = groups.value.map((group) => (group.index === index ? { ...group, label } : group))
  }
  async function save(): Promise<OrganizeEpubTocResult | null> {
    if (saving.value || loading.value || !state.value || !changed.value) return null
    const current = generation
    const path = `/api/v1/books/${bookId.value}/files/${fileId.value}/toc/organize`
    const body = { expectedSha256: state.value.sha256, groups: groups.value.map((group) => ({ index: group.index, label: group.label.trim() })) }
    saving.value = true
    error.value = null
    try {
      const response = await api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) {
        if (current === generation) error.value = response.status === 409 ? 'stale' : 'saveFailed'
        return null
      }
      const result: OrganizeEpubTocResult = await response.json()
      return current === generation ? result : null
    } catch {
      if (current === generation) error.value = 'saveFailed'
      return null
    } finally {
      if (current === generation) saving.value = false
    }
  }
  watch(
    [bookId, fileId],
    () => {
      state.value = null
      groups.value = []
      query.value = ''
      saving.value = false
      void load()
    },
    { immediate: true },
  )
  return {
    state,
    groups,
    selected,
    rows,
    filteredRows,
    query,
    preview,
    loading,
    saving,
    error,
    changed,
    valid,
    load,
    suggest,
    clear,
    toggle,
    rename,
    save,
  }
}
