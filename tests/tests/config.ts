/**
 * Deployment endpoints for the E2E suite, supplied via environment variables
 * so the tests run against any deployment (nothing is hardcoded):
 *
 *   ADMIN_BASE_URL   - admin dashboard URL, e.g. https://celladmin.cells.example.com
 *   ROUTING_API_URL  - global routing API, e.g. https://abc123.execute-api.us-east-1.amazonaws.com/prod
 *   CELL_URLS        - comma-separated cell page URLs
 *   CELL_API_URLS    - comma-separated cell API URLs (same order as CELL_URLS)
 *
 * Suites that need a value which is not set are skipped, so the suite passes
 * cleanly when nothing is deployed.
 */

export const ADMIN_BASE_URL = process.env.ADMIN_BASE_URL || '';
export const ROUTING_API_URL = process.env.ROUTING_API_URL || '';

export const CELL_URLS = (process.env.CELL_URLS || '')
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);

export const CELL_API_URLS = (process.env.CELL_API_URLS || '')
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);

export const CELLS = CELL_URLS.map((url, i) => ({
  url,
  apiUrl: CELL_API_URLS[i] || '',
}));

/** Matches any API request to the routing layer or a cell API. */
export function isApiRequest(url: string): boolean {
  return url.includes('execute-api') || (!!ROUTING_API_URL && url.startsWith(ROUTING_API_URL));
}
