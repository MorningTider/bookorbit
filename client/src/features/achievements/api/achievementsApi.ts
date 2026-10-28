import { i18n } from '@/i18n'
import type { AchievementCatalogueResponse, AchievementHintsResponse } from '@bookorbit/types'
import { api } from '@/lib/api'

export async function fetchAchievements(): Promise<AchievementCatalogueResponse> {
  const res = await api('/api/v1/achievements')
  if (!res.ok) throw new Error(i18n.global.t('customUi.runtimeMessages.failedToFetchAchievements'))
  return res.json()
}

export async function fetchAchievementHints(): Promise<AchievementHintsResponse> {
  const res = await api('/api/v1/achievements/hints')
  if (!res.ok) throw new Error(i18n.global.t('customUi.runtimeMessages.failedToFetchAchievementHints'))
  return res.json()
}
