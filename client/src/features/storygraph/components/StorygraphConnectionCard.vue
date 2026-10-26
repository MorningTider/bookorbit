<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { Button } from '@/components/ui/button'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { Link, Save, CheckCircle2, AlertCircle, Info, Loader2, Unlink } from '@lucide/vue'
import { toast } from 'vue-sonner'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { SECRET_INPUT_ATTRS } from '@/lib/secret-input'
import { useStorygraphSettings } from '../composables/useStorygraphSettings'
const { t } = useI18n()

const { settings, saving, validating, error, fetchSettings, saveSettings, disconnect, validateCookies } = useStorygraphSettings()

const sessionCookieInput = ref('')
const rememberTokenInput = ref('')
const cookiesVisible = ref(false)
const validationResult = ref<{ valid: boolean } | null>(null)

const form = reactive({
  enabled: true,
  bookSyncMode: 'all_eligible' as 'all_eligible' | 'selected_only',
  autoSyncOnStatusChange: true,
  autoSyncOnProgressUpdate: true,
})

onMounted(async () => {
  await fetchSettings()
  if (settings.value) {
    form.enabled = settings.value.enabled
    form.bookSyncMode = settings.value.bookSyncMode
    form.autoSyncOnStatusChange = settings.value.autoSyncOnStatusChange
    form.autoSyncOnProgressUpdate = settings.value.autoSyncOnProgressUpdate
  }
})

// A lingering result would misrepresent edited values, so any input change resets it.
watch([sessionCookieInput, rememberTokenInput], () => {
  validationResult.value = null
})

async function handleValidateCookies() {
  if (!sessionCookieInput.value.trim() || !rememberTokenInput.value.trim()) {
    toast.error(t('uiText.storygraphConnectionCard.enterBothCookieValuesFirst'))
    return
  }
  const result = await validateCookies(sessionCookieInput.value.trim(), rememberTokenInput.value.trim())
  validationResult.value = result
}

async function handleSave() {
  const hasNewCookies = sessionCookieInput.value.trim() && rememberTokenInput.value.trim()
  if (!hasNewCookies && (sessionCookieInput.value.trim() || rememberTokenInput.value.trim())) {
    toast.error(t('uiText.storygraphConnectionCard.enterBothCookieValuesToUpdateTheConnection'))
    return
  }
  const ok = await saveSettings({
    ...(hasNewCookies ? { sessionCookie: sessionCookieInput.value.trim(), rememberToken: rememberTokenInput.value.trim() } : {}),
    enabled: form.enabled,
    bookSyncMode: form.bookSyncMode,
    autoSyncOnStatusChange: form.autoSyncOnStatusChange,
    autoSyncOnProgressUpdate: form.autoSyncOnProgressUpdate,
  })
  if (ok) {
    sessionCookieInput.value = ''
    rememberTokenInput.value = ''
    toast.success(t('uiText.storygraphConnectionCard.storygraphSettingsSaved'))
  } else {
    toast.error(error.value ?? t('uiText.storygraphConnectionCard.failedToSaveSettings'))
  }
}

async function handleDisconnect() {
  await disconnect()
  sessionCookieInput.value = ''
  rememberTokenInput.value = ''
  validationResult.value = null
  toast.success(t('uiText.storygraphConnectionCard.storygraphDisconnected'))
}

function toggleCookiesVisible() {
  cookiesVisible.value = !cookiesVisible.value
}

const bookSyncModeOptions = computed(() => [
  {
    id: 'all_eligible' as const,
    label: t('uiText.storygraphConnectionCard.allEligibleBooks'),
    description: t('uiText.storygraphConnectionCard.storygraphSyncRunsForEveryEligibleBookUnlessYouExcludeItOn'),
  },
  {
    id: 'selected_only' as const,
    label: t('uiText.storygraphConnectionCard.selectedBooksOnly'),
    description: t('uiText.storygraphConnectionCard.storygraphSyncOnlyRunsForBooksYouTurnOnFromTheBook'),
  },
])

function selectBookSyncMode(mode: 'all_eligible' | 'selected_only') {
  form.bookSyncMode = mode
}
</script>

<template>
  <div class="border border-border rounded-lg bg-card px-4 py-4 md:px-5 md:py-5 shadow-xs space-y-5">
    <div class="flex items-center gap-3">
      <Link class="size-5 text-primary shrink-0" />
      <div>
        <p class="font-medium text-sm">{{ t('uiText.storygraphConnectionCard.connection') }}</p>
        <p class="text-xs text-muted-foreground mt-0.5">{{ t('uiText.storygraphConnectionCard.connectYourStoryGraphAccountToSyncReadingData') }}</p>
      </div>
      <div v-if="settings?.cookiesConfigured" class="ml-auto flex items-center gap-1.5 text-xs text-green-600">
        <CheckCircle2 class="size-3.5" />{{ t('uiText.storygraphConnectionCard.connected') }}
      </div>
    </div>

    <div class="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2">
      <Info class="size-3.5 shrink-0 text-amber-600 mt-0.5" />
      <p class="text-xs text-amber-700 leading-relaxed">{{ t('uiText.storygraphConnectionCard.storygraphHasNoPublicAPIThisIntegrationWorksBy') }}</p>
    </div>

    <div class="space-y-3">
      <ol class="text-xs text-muted-foreground leading-relaxed list-decimal list-inside space-y-1">
        <li>
          {{ t('uiText.storygraphConnectionCard.logInAt')
          }}<a href="https://app.thestorygraph.com" target="_blank" rel="noopener" class="text-primary underline underline-offset-2"
            >app.thestorygraph.com</a
          >{{ t('uiText.storygraphConnectionCard.inYourBrowser') }}
        </li>
        <li>{{ t('uiText.storygraphConnectionCard.openDeveloperToolsF12AndGoToApplicationStorage') }}</li>
        <li>
          {{ t('uiText.storygraphConnectionCard.copyTheValuesOfThe') }}<code class="px-1 rounded-xs bg-muted">_storygraph_session</code
          >{{ t('uiText.storygraphConnectionCard.and') }}<code class="px-1 rounded-xs bg-muted">remember_user_token</code
          >{{ t('uiText.storygraphConnectionCard.cookiesBelow') }}
        </li>
      </ol>

      <div class="space-y-2">
        <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">_storygraph_session</label>
        <div class="flex gap-2">
          <input
            v-model="sessionCookieInput"
            v-bind="SECRET_INPUT_ATTRS"
            type="text"
            :placeholder="t('uiText.storygraphConnectionCard.pasteTheStorygraphSessionCookieValue')"
            class="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            :class="{ 'input-secret': !cookiesVisible }"
          />
        </div>
      </div>

      <div class="space-y-2">
        <label class="text-xs font-medium text-muted-foreground uppercase tracking-wider">remember_user_token</label>
        <div class="flex gap-2">
          <input
            v-model="rememberTokenInput"
            v-bind="SECRET_INPUT_ATTRS"
            type="text"
            :placeholder="t('uiText.storygraphConnectionCard.pasteTheRememberUserTokenCookieValue')"
            class="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            :class="{ 'input-secret': !cookiesVisible }"
          />
          <Button variant="outline" size="sm" type="button" @click="toggleCookiesVisible">
            {{ cookiesVisible ? t('uiText.storygraphConnectionCard.hide') : t('uiText.storygraphConnectionCard.show') }}
          </Button>
        </div>
      </div>
    </div>

    <div class="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        type="button"
        :disabled="validating || !sessionCookieInput.trim() || !rememberTokenInput.trim()"
        @click="handleValidateCookies"
      >
        <Loader2 v-if="validating" class="size-3 animate-spin" />{{ t('uiText.storygraphConnectionCard.validateCookies') }}</Button
      >
      <span
        v-if="validationResult !== null"
        class="flex items-center gap-1 text-xs"
        :class="validationResult.valid ? 'text-green-600' : 'text-destructive'"
      >
        <CheckCircle2 v-if="validationResult.valid" class="size-3.5" />
        <AlertCircle v-else class="size-3.5" />
        {{ validationResult.valid ? t('uiText.storygraphConnectionCard.valid') : t('uiText.storygraphConnectionCard.invalidOrExpiredCookies') }}
      </span>
    </div>

    <div v-if="settings?.cookiesConfigured" class="space-y-3 pt-2 border-t border-border">
      <p class="text-xs font-medium text-muted-foreground uppercase tracking-wider">{{ t('uiText.storygraphConnectionCard.syncOptions') }}</p>
      <div class="flex items-start gap-2 rounded-md border border-border/70 bg-muted/40 px-2.5 py-2">
        <Info class="size-3.5 shrink-0 text-muted-foreground mt-0.5" />
        <p class="text-xs text-muted-foreground leading-relaxed">{{ t('uiText.storygraphConnectionCard.syncRunsOnlyForBooksThatAreNotUnread') }}</p>
      </div>

      <div class="space-y-2">
        <div>
          <p class="text-sm">{{ t('uiText.storygraphConnectionCard.bookSyncScope') }}</p>
          <p class="text-xs text-muted-foreground mt-0.5">
            {{ t('uiText.storygraphConnectionCard.chooseWhetherStoryGraphSyncStartsBroadlyOrOnlyFor') }}
          </p>
        </div>
        <div class="grid gap-2 sm:grid-cols-2">
          <button
            v-for="option in bookSyncModeOptions"
            :key="option.id"
            type="button"
            class="rounded-md border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="!form.enabled"
            :class="
              form.bookSyncMode === option.id
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-border bg-background text-muted-foreground hover:bg-muted/50'
            "
            @click="selectBookSyncMode(option.id)"
          >
            <div class="text-sm font-medium">{{ option.label }}</div>
            <div class="mt-0.5 text-xs leading-relaxed">{{ option.description }}</div>
          </button>
        </div>
      </div>

      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm">{{ t('uiText.storygraphConnectionCard.enableSync') }}</p>
          <p class="text-xs text-muted-foreground mt-0.5">{{ t('uiText.storygraphConnectionCard.pauseAllStoryGraphSyncingWithoutDisconnecting') }}</p>
        </div>
        <ToggleSwitch v-model="form.enabled" />
      </div>

      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm">{{ t('uiText.storygraphConnectionCard.syncOnStatusChange') }}</p>
          <p class="text-xs text-muted-foreground mt-0.5">{{ t('uiText.storygraphConnectionCard.pushUpdatesWhenYouMarkABookAsReading') }}</p>
        </div>
        <ToggleSwitch v-model="form.autoSyncOnStatusChange" :disabled="!form.enabled" />
      </div>

      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm">{{ t('uiText.storygraphConnectionCard.syncOnProgressUpdate') }}</p>
          <p class="text-xs text-muted-foreground mt-0.5">
            {{ t('uiText.storygraphConnectionCard.pushReadingProgressWhenBookOrbitOrKOReaderProgressChanges') }}
          </p>
        </div>
        <ToggleSwitch v-model="form.autoSyncOnProgressUpdate" :disabled="!form.enabled" />
      </div>
    </div>

    <div class="flex items-center justify-between pt-2 border-t border-border gap-2">
      <Button variant="destructive-ghost" size="sm" v-if="settings?.cookiesConfigured" type="button" :disabled="saving" @click="handleDisconnect">
        <Unlink class="size-3.5" />{{ t('uiText.storygraphConnectionCard.disconnect') }}</Button
      >
      <div class="flex-1" />
      <Button size="sm" type="button" :disabled="saving" @click="handleSave">
        <Loader2 v-if="saving" class="size-3.5 animate-spin" />
        <Save v-else class="size-3.5" />{{ t('uiText.storygraphConnectionCard.save') }}</Button
      >
    </div>
  </div>
</template>
