export type DevFallbackOptions = {
  isDev: boolean;
  configured?: string;
};

const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);
const DISABLED_VALUES = new Set(['0', 'false', 'no', 'off']);

/**
 * Mock/demo data may only mask an unavailable backend in development.
 * Production always fails closed, even if a stale build variable says otherwise.
 */
export function isDevOnlyFallbackEnabled(options: DevFallbackOptions): boolean {
  if (!options.isDev) return false;

  const configured = options.configured?.trim().toLowerCase();
  if (!configured) return true;
  if (ENABLED_VALUES.has(configured)) return true;
  if (DISABLED_VALUES.has(configured)) return false;
  return false;
}
