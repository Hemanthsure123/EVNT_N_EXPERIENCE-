'use client';

import { useReportWebVitals } from 'next/web-vitals';

/**
 * Core Web Vitals reporting. Budget (Design System §15): LCP < 2.5s, CLS < 0.1,
 * INP < 200ms. In dev we log each metric (with its good/needs-improvement/poor
 * rating) to the console; in prod, swap the sink for a `navigator.sendBeacon`
 * POST to an analytics endpoint. Mounted once in the root layout.
 */
export function WebVitals() {
  useReportWebVitals((metric) => {
    if (process.env.NODE_ENV === 'production') {
      // Placeholder for the field-data sink (added with the analytics module):
      // navigator.sendBeacon('/api/vitals', JSON.stringify(metric));
      return;
    }
    // eslint-disable-next-line no-console
    console.log(
      `[web-vitals] ${metric.name}: ${Math.round(metric.value)} — ${metric.rating ?? 'n/a'}`,
    );
  });
  return null;
}
