<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { Button } from '@/components/ui/button'
import { computed } from 'vue'
import { AlertCircle, RefreshCw, XCircle, Loader2 } from '@lucide/vue'
import { useStorygraphSync } from '../composables/useStorygraphSync'
import { useStorygraphSettings } from '../composables/useStorygraphSettings'
const { t } = useI18n()

const {
  activeSyncStatus,
  lastRunSummary,
  syncFailures,
  syncing,
  isSyncing,
  syncProgress,
  pendingSummary,
  loadingPending,
  error,
  startSync,
  cancelSync,
} = useStorygraphSync()
const { settings } = useStorygraphSettings()

const progressLabel = computed(() => {
  const s = activeSyncStatus.value
  if (!s) return ''
  return t('uiText.storygraphSyncProgress.processedBooks', { processed: s.processedBooks, total: s.totalBooks })
})

const liveCountsLabel = computed(() => {
  const s = activeSyncStatus.value
  if (!s) return ''
  const parts = [t('uiText.storygraphSyncProgress.syncedCount', { count: s.syncedBooks })]
  if (s.skippedBooks > 0) parts.push(t('uiText.storygraphSyncProgress.skippedCount', { count: s.skippedBooks }))
  return parts.join(' · ')
})

const lastRunLabel = computed(() => {
  const s = lastRunSummary.value
  if (!s) return null
  const verb = s.status === 'cancelled' ? t('uiText.storygraphSyncProgress.lastRunCancelled') : t('uiText.storygraphSyncProgress.lastRun')
  return t('uiText.storygraphSyncProgress.lastRunSummary', { label: verb, synced: s.syncedBooks, skipped: s.skippedBooks, failed: s.failedBooks })
})

const failureLabel = (error: string): string => {
  switch (error) {
    case 'no_match':
      return t('uiText.storygraphSyncProgress.noStoryGraphMatchFound')
    case 'storygraph_session_expired':
      return t('uiText.storygraphSyncProgress.storygraphSessionExpiredRePasteYourCookies')
    default:
      return error.startsWith('status_update_failed') ? t('uiText.storygraphSyncProgress.storygraphRejectedTheStatusUpdate') : error
  }
}

const hasPending = computed(() => pendingSummary.value.pendingBooks > 0)
const syncScopeLabel = computed(() =>
  settings.value?.bookSyncMode === 'selected_only'
    ? t('uiText.storygraphSyncProgress.selectedBooks')
    : t('uiText.storygraphSyncProgress.eligibleBooks'),
)
const syncUnavailableReason = computed(() => {
  switch (settings.value?.disabledReason) {
    case 'permission_denied':
      return t('uiText.storygraphSyncProgress.youDoNotHavePermissionToUseStoryGraphSync')
    case 'user_disabled':
      return t('uiText.storygraphSyncProgress.syncIsPausedInYourStoryGraphSettings')
    default:
      return null
  }
})
const syncButtonDisabled = computed(() => syncing.value || loadingPending.value || !hasPending.value || syncUnavailableReason.value !== null)
const syncButtonLabel = computed(() => {
  if (syncUnavailableReason.value) return t('uiText.storygraphSyncProgress.syncUnavailable')
  return hasPending.value
    ? t('uiText.storygraphSyncProgress.syncNowCount', { count: pendingSummary.value.pendingBooks })
    : t('uiText.storygraphSyncProgress.syncNow')
})

const lastSyncedLabel = computed(() => {
  const iso = settings.value?.lastSyncedAt
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)
  if (minutes < 1) return t('uiText.storygraphSyncProgress.justNow')
  if (minutes < 60) return t('uiText.storygraphSyncProgress.minutesAgo', { count: minutes })
  if (hours < 24) return t('uiText.storygraphSyncProgress.hoursAgo', { count: hours })
  return t('uiText.storygraphSyncProgress.daysAgo', { count: days })
})
</script>

<template>
  <div class="border border-border rounded-lg bg-card px-4 py-4 md:px-5 md:py-5 shadow-xs space-y-4">
    <div class="flex items-center justify-between gap-4">
      <div>
        <p class="font-medium text-sm">{{ t('uiText.storygraphSyncProgress.manualSync') }}</p>
        <p class="text-xs text-muted-foreground mt-0.5">
          {{ t('uiText.storygraphSyncProgress.pushScope', { scope: syncScopeLabel }) }}
        </p>
        <p v-if="!isSyncing" class="text-xs text-muted-foreground mt-1">
          <template v-if="loadingPending">{{ t('uiText.storygraphSyncProgress.checkingPendingItems') }}</template>
          <template v-else-if="hasPending">
            {{ t('uiText.storygraphSyncProgress.pendingSummary', { pending: pendingSummary.pendingBooks, total: pendingSummary.totalBooks })
            }}<span v-if="syncUnavailableReason">{{ syncUnavailableReason }}</span>
          </template>
          <template v-else-if="syncUnavailableReason">{{ syncUnavailableReason }}</template>
          <template v-else-if="pendingSummary.totalBooks === 0">{{ t('uiText.storygraphSyncProgress.noBooksInSyncScope') }}</template>
          <template v-else>{{ t('uiText.storygraphSyncProgress.allBooksAreAlreadySynced') }}</template>
        </p>
        <p v-if="lastSyncedLabel && !isSyncing" class="text-xs text-muted-foreground mt-0.5">
          {{ syncUnavailableReason ? t('uiText.storygraphSyncProgress.lastSuccessfulSync') : t('uiText.storygraphSyncProgress.lastSynced') }}:
          {{ lastSyncedLabel }}
        </p>
        <p v-if="error && !isSyncing" class="flex items-center gap-1 text-xs text-destructive mt-1">
          <AlertCircle class="size-3.5" />
          {{ error }}
        </p>
      </div>

      <div class="flex items-center gap-2">
        <Button size="sm" v-if="!isSyncing" type="button" :disabled="syncButtonDisabled" @click="startSync">
          <Loader2 v-if="syncing" class="size-3.5 animate-spin" />
          <RefreshCw v-else class="size-3.5" />
          {{ syncButtonLabel }}
        </Button>
        <Button variant="outline" size="sm" v-else type="button" @click="cancelSync">
          <XCircle class="size-3.5" />{{ t('uiText.storygraphSyncProgress.cancel') }}</Button
        >
      </div>
    </div>

    <div v-if="isSyncing" class="space-y-1.5">
      <div class="flex justify-between text-xs text-muted-foreground">
        <span
          >{{ t('uiText.storygraphSyncProgress.syncing') }}{{ liveCountsLabel }}
          <span v-if="activeSyncStatus && activeSyncStatus.failedBooks > 0" class="text-destructive"
            >· {{ t('uiText.storygraphSyncProgress.failedCount', { count: activeSyncStatus.failedBooks }) }}</span
          >
        </span>
        <span>{{ progressLabel }}</span>
      </div>
      <div class="h-1.5 rounded-full bg-muted overflow-hidden">
        <div class="h-full rounded-full bg-primary transition-all duration-300" :style="{ width: `${syncProgress}%` }" />
      </div>
    </div>

    <p v-if="lastRunLabel && !isSyncing" class="text-xs text-muted-foreground">
      {{ lastRunLabel }}
    </p>

    <div v-if="syncFailures.length > 0 && !isSyncing" class="space-y-1.5 pt-2 border-t border-border">
      <p class="flex items-center gap-1.5 text-xs font-medium text-destructive">
        <AlertCircle class="size-3.5 shrink-0" />
        {{ t('uiText.storygraphSyncProgress.booksFailed', { count: syncFailures.length }) }}
      </p>
      <ul class="space-y-1">
        <li v-for="failure in syncFailures" :key="failure.bookId" class="text-xs text-muted-foreground">
          <span class="text-foreground">{{ failure.title }}</span>
          <span v-if="failure.authorName"> - {{ failure.authorName }}</span>
          <span class="text-destructive"> · {{ failureLabel(failure.syncError) }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
