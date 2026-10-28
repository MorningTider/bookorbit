import { i18n } from '@/i18n'

const INSIGHT_LABEL_KEYS: Record<string, string> = {
  Short: 'short',
  Medium: 'medium',
  Long: 'long',
  Focused: 'focused',
  Balanced: 'balanced',
  Eclectic: 'eclectic',
  Bursty: 'bursty',
  Moderate: 'moderate',
  Steady: 'steady',
  'Night Owl': 'nightOwl',
  'Early Bird': 'earlyBird',
  Afternoon: 'afternoon',
  Evening: 'evening',
  'Slow Savorer': 'slowSavorer',
  'Steady Pacer': 'steadyPacer',
  'Speed Demon': 'speedDemon',
  'N/A': 'nA',
  'Night Owl Epic Specialist': 'nightOwlEpicSpecialist',
  'Steady Eclectic Explorer': 'steadyEclecticExplorer',
  'Disciplined Genre Hopper': 'disciplinedGenreHopper',
  'Early Bird Marathon Reader': 'earlyBirdMarathonReader',
  'Rapid Explorer': 'rapidExplorer',
  'Patient Specialist': 'patientSpecialist',
  'Deep Specialist': 'deepSpecialist',
  'Weekend Binge Reader': 'weekendBingeReader',
  'Curious Explorer': 'curiousExplorer',
  'Steady Habit Reader': 'steadyHabitReader',
  'Avid Reader': 'avidReader',
  'Comfortable Reader': 'comfortableReader',
  'Literary Adventurer': 'literaryAdventurer',
}

export function insightLabel(value: string): string {
  const key = INSIGHT_LABEL_KEYS[value]
  return i18n.global.t(key ? `customUi.insights.${key}` : 'customUi.insights.unknown')
}
