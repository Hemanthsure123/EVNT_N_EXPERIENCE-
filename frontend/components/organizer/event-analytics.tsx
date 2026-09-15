/**
 * `/dashboard/events/{id}/analytics` renders `EventAnalytics`. The page itself
 * now lives in `./analytics/` as the six sections it is made of — see
 * `analytics-dashboard.tsx` — and this name stays so the route, and anything
 * else that imports it, does not have to change.
 */
export { AnalyticsDashboard as EventAnalytics } from './analytics/analytics-dashboard';
