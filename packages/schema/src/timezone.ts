// Shared so three call sites (account settings write, stats read fallback, dashboard pre-paint fallback) agree on what's storable.
export function isSupportedTimeZone(zone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}
