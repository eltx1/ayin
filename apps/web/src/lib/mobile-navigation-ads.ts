/** A route change owns one short-lived interstitial opportunity, not a queued ad.
 * Identity must settle first. Consent/config/account changes invalidate the opportunity
 * rather than replaying it when permission returns later.
 */
export interface MobileNavigationPermission {
  accountId: string | null;
  consentGranted: boolean;
  configuration: object | null;
}

export interface MobileNavigationAdPort {
  refreshIdentity(signal: AbortSignal): Promise<void>;
  permission(): MobileNavigationPermission;
  subscribe(listener: () => void): () => void;
  eligible(): boolean;
  currentRoute(): string;
  surfaceIdle(): boolean;
  request(previous: string, next: string): void;
}

export async function reconcileMobileNavigation(
  previous: string | null,
  next: string,
  signal: AbortSignal,
  port: MobileNavigationAdPort,
  options: { isBrowseRoute: (route: string) => boolean; now?: () => number },
): Promise<boolean> {
  const now = options.now ?? Date.now;
  const started = now();
  const permission = port.permission();
  let candidate = Boolean(
    previous &&
    previous !== next &&
    options.isBrowseRoute(previous) &&
    options.isBrowseRoute(next) &&
    permission.consentGranted &&
    port.eligible() &&
    port.surfaceIdle(),
  );
  const currentPermissionMatches = () => {
    const current = port.permission();
    return (
      current.accountId === permission.accountId &&
      current.configuration === permission.configuration &&
      current.consentGranted
    );
  };
  const stop = port.subscribe(() => {
    if (!currentPermissionMatches()) candidate = false;
  });
  try {
    await port.refreshIdentity(signal);
    if (
      !candidate ||
      !previous ||
      signal.aborted ||
      now() - started > 1500 ||
      port.currentRoute() !== next ||
      !currentPermissionMatches() ||
      !port.eligible() ||
      !port.surfaceIdle()
    )
      return false;
    port.request(previous, next);
    return true;
  } catch {
    // Optional advertising must not turn an identity/network failure into a broken page.
    return false;
  } finally {
    stop();
  }
}
