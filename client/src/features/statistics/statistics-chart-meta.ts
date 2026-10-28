import type { Component } from 'vue'
import {
  BarChart3,
  BookCheck,
  Calendar,
  CalendarDays,
  CalendarRange,
  Clock,
  Clock3,
  BookOpen,
  GitMerge,
  Goal,
  Globe,
  Gauge,
  HardDrive,
  Layers,
  ListChecks,
  MonitorSmartphone,
  PieChart,
  Rabbit,
  ShieldCheck,
  Tag,
  TrendingUp,
  Users,
  Waypoints,
  Zap,
} from '@lucide/vue'

import { DEFAULT_LIBRARY_CHART_ORDER, DEFAULT_USER_CHART_ORDER, type StatisticsChartId } from '@bookorbit/types'

export type StatisticsChartSize = '1x1' | '2x1' | '2x2' | '1x2' | '3x1' | '4x1'
export type StatisticsChartCategory = 'library' | 'user'

export interface StatisticsChartMetaEntry {
  labelKey: string
  icon: Component
  size: StatisticsChartSize
  category: StatisticsChartCategory
}

export const STATISTICS_CHART_META: Record<StatisticsChartId, StatisticsChartMetaEntry> = {
  'format-distribution': {
    labelKey: 'statistics.charts.formatDistribution.title',
    icon: PieChart,
    size: '1x1',
    category: 'library',
  },
  'language-distribution': {
    labelKey: 'statistics.charts.languageDistribution.title',
    icon: Globe,
    size: '1x1',
    category: 'library',
  },
  'books-added-over-time': {
    labelKey: 'statistics.charts.booksAddedOverTime.title',
    icon: TrendingUp,
    size: '2x1',
    category: 'library',
  },
  'storage-by-format': {
    labelKey: 'statistics.charts.storageByFormat.title',
    icon: HardDrive,
    size: '1x1',
    category: 'library',
  },
  'publication-decade': {
    labelKey: 'statistics.charts.publicationDecade.title',
    icon: CalendarDays,
    size: '1x1',
    category: 'library',
  },
  'top-authors': {
    labelKey: 'statistics.charts.topAuthors.title',
    icon: Users,
    size: '2x1',
    category: 'library',
  },
  'metadata-completeness': {
    labelKey: 'statistics.charts.metadataCompleteness.title',
    icon: ListChecks,
    size: '1x1',
    category: 'library',
  },
  'genre-distribution': {
    labelKey: 'statistics.charts.genreDistribution.title',
    icon: Tag,
    size: '2x1',
    category: 'library',
  },
  'metadata-score-distribution': {
    labelKey: 'statistics.charts.metadataScoreDistribution.title',
    icon: BarChart3,
    size: '1x1',
    category: 'library',
  },
  'library-metadata-completeness': {
    labelKey: 'statistics.charts.libraryMetadataCompleteness.title',
    icon: ListChecks,
    size: '2x1',
    category: 'library',
  },
  'genre-cooccurrence': {
    labelKey: 'statistics.charts.genreCooccurrence.title',
    icon: GitMerge,
    size: '2x2',
    category: 'library',
  },
  'format-share-over-time': {
    labelKey: 'statistics.charts.formatShareOverTime.title',
    icon: TrendingUp,
    size: '2x1',
    category: 'library',
  },
  'page-count-distribution': {
    labelKey: 'statistics.charts.pageCountDistribution.title',
    icon: BookOpen,
    size: '1x1',
    category: 'library',
  },
  'metadata-freshness-gauge': {
    labelKey: 'statistics.charts.metadataFreshness.title',
    icon: Gauge,
    size: '1x1',
    category: 'library',
  },
  'library-integrity-gauge': {
    labelKey: 'statistics.charts.libraryIntegrity.title',
    icon: ShieldCheck,
    size: '1x1',
    category: 'library',
  },
  'acquisition-lag-scatter': {
    labelKey: 'statistics.charts.acquisitionLag.title',
    icon: CalendarRange,
    size: '1x1',
    category: 'library',
  },
  'largest-books': {
    labelKey: 'statistics.charts.largestBooks.title',
    icon: HardDrive,
    size: '2x1',
    category: 'library',
  },
  'top-series': {
    labelKey: 'statistics.charts.topSeries.title',
    icon: Layers,
    size: '2x1',
    category: 'library',
  },
  'publication-year-timeline': {
    labelKey: 'statistics.charts.publicationYearTimeline.title',
    icon: TrendingUp,
    size: '4x1',
    category: 'library',
  },
  'reading-heatmap': {
    labelKey: 'statistics.charts.readingHeatmap.title',
    icon: Calendar,
    size: '2x1',
    category: 'user',
  },
  'reading-source-distribution': {
    labelKey: 'statistics.charts.sourceDistribution.title',
    icon: MonitorSmartphone,
    size: '1x1',
    category: 'user',
  },
  'peak-reading-hours': {
    labelKey: 'statistics.charts.peakReadingHours.title',
    icon: Clock3,
    size: '2x1',
    category: 'user',
  },
  'favorite-reading-days': {
    labelKey: 'statistics.charts.favoriteReadingDays.title',
    icon: CalendarDays,
    size: '1x1',
    category: 'user',
  },
  'completion-timeline': {
    labelKey: 'statistics.charts.completionTimeline.title',
    icon: CalendarRange,
    size: '2x1',
    category: 'user',
  },
  'goal-trajectory': {
    labelKey: 'statistics.charts.goalTrajectory.title',
    icon: Goal,
    size: '2x1',
    category: 'user',
  },
  'progress-funnel': {
    labelKey: 'statistics.charts.progressFunnel.title',
    icon: Waypoints,
    size: '1x1',
    category: 'user',
  },
  'completion-latency': {
    labelKey: 'statistics.charts.completionLatency.title',
    icon: Rabbit,
    size: '1x1',
    category: 'user',
  },
  'genre-reading-time': {
    labelKey: 'statistics.charts.genreReadingTime.title',
    icon: Tag,
    size: '2x1',
    category: 'user',
  },
  'reading-pace': {
    labelKey: 'statistics.charts.readingPace.title',
    icon: Zap,
    size: '2x1',
    category: 'user',
  },
  'books-completed': {
    labelKey: 'statistics.charts.booksCompleted.title',
    icon: BookCheck,
    size: '2x1',
    category: 'user',
  },
  'reading-clock': {
    labelKey: 'statistics.charts.readingClock.title',
    icon: Clock,
    size: '1x1',
    category: 'user',
  },
  'reading-session-timeline': {
    labelKey: 'statistics.charts.readingSessionTimeline.title',
    icon: Clock3,
    size: '2x1',
    category: 'user',
  },
  'session-archetypes': {
    labelKey: 'statistics.charts.sessionArchetypes.title',
    icon: Layers,
    size: '2x1',
    category: 'user',
  },
}

export const LIBRARY_CHART_IDS: StatisticsChartId[] = DEFAULT_LIBRARY_CHART_ORDER.filter((id): id is StatisticsChartId => id in STATISTICS_CHART_META)

export const USER_CHART_IDS: StatisticsChartId[] = DEFAULT_USER_CHART_ORDER.filter((id): id is StatisticsChartId => id in STATISTICS_CHART_META)

export const STATISTICS_CHART_IDS: StatisticsChartId[] = [...LIBRARY_CHART_IDS, ...USER_CHART_IDS]
