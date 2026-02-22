/**
 * Dashboard module barrel exports.
 */

export { DashboardDataCollector } from './data-collector.js';
export type { DashboardDataCollectorDeps } from './data-collector.js';

export { createDashboardRouter } from './routes.js';
export type { DashboardRouteDeps } from './routes.js';

export { renderDashboardPage, esc } from './templates.js';
export type {
  OverviewPageData,
  AnalyticsPageData,
  UsersPageData,
  SettingsPageData,
  PageData,
} from './templates.js';

export type {
  IndexOverview,
  SearchAnalytics,
  UserInfo,
  UsageStats,
  DashboardConfig,
  DashboardPage,
  FlashMessage,
  DailyQueryCount,
  TopQuery,
  SearchRecord,
  RequestRecord,
} from './types.js';
