import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { GithubBookRepository, GithubBookSourceConfig, GithubBookSourceUpdate, GithubRepositoryInput } from '@bookorbit/types'
import { api } from '@/lib/api'
import { githubSourceError } from './github-source-errors'

export function useGithubSourceConfig() {
  const { t } = useI18n()
  const draft = ref<GithubBookSourceUpdate | null>(null)
  const saved = ref('')
  const statuses = ref<GithubBookRepository[]>([])
  const loading = ref(false)
  const busy = ref(false)
  const error = ref<string | null>(null)
  const notice = ref<string | null>(null)
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const dirty = computed(() => draft.value !== null && JSON.stringify(draft.value) !== saved.value)

  function editable(config: GithubBookSourceConfig): GithubBookSourceUpdate {
    return {
      revision: config.revision,
      enabled: config.enabled,
      repositories: config.repositories.map(({ id, label, repository, branch, path, formats, enabled }) => ({
        id,
        label,
        repository,
        branch,
        path,
        formats,
        enabled,
      })),
    }
  }
  async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await api('/api/v1/book-sources/github/' + url, init)
    const data = await response.json()
    if (!response.ok) throw new Error(typeof data.message === 'string' ? githubSourceError(data.message) : t('githubSources.requestFailed'))
    return data as T
  }
  async function load(replaceDraft = false) {
    loading.value = true
    try {
      const config = await request<GithubBookSourceConfig>('config')
      if (stopped) return
      statuses.value = config.repositories
      if (replaceDraft || !draft.value) {
        draft.value = editable(config)
        saved.value = JSON.stringify(draft.value)
      }
      error.value = null
    } catch (cause) {
      error.value = cause instanceof Error ? githubSourceError(cause.message) : t('githubSources.requestFailed')
    } finally {
      loading.value = false
      clearTimeout(timer)
      if (!stopped && statuses.value.some((repo) => repo.indexState === 'indexing')) timer = setTimeout(poll, 3000)
    }
  }
  function poll() {
    return load()
  }
  async function discard() {
    await load(true)
  }
  async function save(): Promise<boolean> {
    if (!draft.value) return true
    if (!dirty.value) return true
    busy.value = true
    error.value = null
    try {
      const config = await request<GithubBookSourceConfig>('config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft.value),
      })
      statuses.value = config.repositories
      draft.value = editable(config)
      saved.value = JSON.stringify(draft.value)
      notice.value = t('githubSources.saved')
      return true
    } catch (cause) {
      error.value = cause instanceof Error ? githubSourceError(cause.message) : t('githubSources.requestFailed')
      return false
    } finally {
      busy.value = false
    }
  }
  function add() {
    draft.value?.repositories.push({ label: '', repository: '', branch: '', path: '', formats: ['epub'], enabled: true })
  }
  function remove(index: number) {
    draft.value?.repositories.splice(index, 1)
  }
  function toggle() {
    if (draft.value) draft.value.enabled = !draft.value.enabled
  }
  function statusFor(repo: GithubRepositoryInput) {
    return statuses.value.find((row) => row.id === repo.id)
  }
  async function action(repo: GithubRepositoryInput, actionName: 'test' | 'refresh') {
    if (!repo.id || dirty.value || busy.value) return
    busy.value = true
    error.value = null
    notice.value = null
    try {
      await request(`repositories/${repo.id}/${actionName}`, { method: 'POST' })
      notice.value = t(actionName === 'test' ? 'githubSources.connected' : 'githubSources.indexStarted')
      await load()
    } catch (cause) {
      error.value = cause instanceof Error ? githubSourceError(cause.message) : t('githubSources.requestFailed')
    } finally {
      busy.value = false
    }
  }
  function test(repo: GithubRepositoryInput) {
    return action(repo, 'test')
  }
  function refresh(repo: GithubRepositoryInput) {
    return action(repo, 'refresh')
  }
  watch(dirty, () => {
    notice.value = null
  })
  onMounted(discard)
  onUnmounted(() => {
    stopped = true
    clearTimeout(timer)
  })
  return { draft, dirty, loading, busy, error, notice, save, discard, add, remove, toggle, statusFor, test, refresh }
}
