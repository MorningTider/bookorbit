import { i18n } from '@/i18n'
import { driver } from 'driver.js'
import type { DriveStep } from 'driver.js'
import 'driver.js/dist/driver.css'
import { useAuth } from '@/features/auth/composables/useAuth'
import { api } from '@/lib/api'

export function useOnboardingTour() {
  const { user, me } = useAuth()

  function isMobileViewport(): boolean {
    return typeof window !== 'undefined' && window.innerWidth < 768
  }

  function isTourCompleted(): boolean {
    return user.value?.settings?.onboarding?.tourCompleted === true
  }

  function buildSteps(): DriveStep[] {
    const candidates: DriveStep[] = [
      // Left sidebar - top to bottom
      {
        element: '[data-tour="sidebar-libraries"]',
        popover: {
          title: i18n.global.t('customUi.tour.librariesTitle'),
          description: i18n.global.t('customUi.tour.librariesDescription'),
          side: 'right',
          align: 'start',
          showButtons: ['next', 'close'],
        },
      },
      {
        element: '[data-tour="sidebar-smartScopes"]',
        popover: {
          title: i18n.global.t('customUi.tour.smartScopesTitle'),
          description: i18n.global.t('customUi.tour.smartScopesDescription'),
          side: 'right',
          align: 'start',
        },
      },
      {
        element: '[data-tour="sidebar-collections"]',
        popover: {
          title: i18n.global.t('customUi.tour.collectionsTitle'),
          description: i18n.global.t('customUi.tour.collectionsDescription'),
          side: 'right',
          align: 'start',
        },
      },
      // The rest of the shell lives in the sidebar too, so every popover opens to its right.
      {
        element: '[data-tour="global-search"]',
        popover: {
          title: i18n.global.t('customUi.tour.searchTitle'),
          description: i18n.global.t('customUi.tour.searchDescription'),
          side: 'right',
          align: 'start',
        },
      },
      {
        element: '[data-tour="book-dock-btn"]',
        popover: {
          title: i18n.global.t('customUi.tour.bookDockTitle'),
          description: i18n.global.t('customUi.tour.bookDockDescription'),
          side: 'right',
          align: 'start',
        },
      },
      {
        element: '[data-tour="statistics-btn"]',
        popover: {
          title: i18n.global.t('customUi.tour.statisticsTitle'),
          description: i18n.global.t('customUi.tour.statisticsDescription'),
          side: 'right',
          align: 'start',
        },
      },
      {
        element: '[data-tour="appearance-picker"]',
        popover: {
          title: i18n.global.t('customUi.tour.appearanceTitle'),
          description: i18n.global.t('customUi.tour.appearanceDescription'),
          side: 'right',
          align: 'end',
        },
      },
    ]

    return candidates.filter((step) => document.querySelector(step.element as string) !== null)
  }

  function markCompletedLocally(): void {
    if (!user.value) return
    user.value = {
      ...user.value,
      settings: {
        ...user.value.settings,
        onboarding: { tourCompleted: true },
      },
    }
  }

  function persistCompletion(): void {
    api('/api/v1/users/me/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { onboarding: { tourCompleted: true } } }),
    }).catch(() => {})
  }

  function startTour(): void {
    const steps = buildSteps()
    if (steps.length === 0) return

    const driverObj = driver({
      showProgress: true,
      progressText: i18n.global.t('customUi.tour.progress', { current: '{{current}}', total: '{{total}}' }),
      nextBtnText: i18n.global.t('customUi.tour.next'),
      prevBtnText: i18n.global.t('customUi.tour.back'),
      doneBtnText: i18n.global.t('customUi.tour.done'),
      disableActiveInteraction: true,
      onDestroyed: () => {
        markCompletedLocally()
        persistCompletion()
      },
      steps,
    })

    driverObj.drive()
  }

  function maybeStartTour(): void {
    if (isMobileViewport()) return
    if (isTourCompleted()) return
    startTour()
  }

  async function resetTour(): Promise<void> {
    await api('/api/v1/users/me/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { onboarding: { tourCompleted: false } } }),
    })
    await me()
    startTour()
  }

  return { maybeStartTour, startTour, resetTour }
}
