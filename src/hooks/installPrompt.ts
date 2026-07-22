export const INSTALL_DISMISSAL_STORAGE_KEY = 'othello.installDismissedAt';
export const INSTALL_DISMISSAL_COOLDOWN_MS = 1000 * 60 * 60 * 24 * 14;

interface NavigatorLike {
  readonly userAgent: string;
  readonly maxTouchPoints?: number;
  readonly standalone?: boolean;
}

interface DisplayModeLike {
  readonly matches: boolean;
}

interface StorageLike {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
}

export function isInstallDismissed(
  storage: Pick<StorageLike, 'getItem'>,
  now: number,
): boolean {
  const rawValue = storage.getItem(INSTALL_DISMISSAL_STORAGE_KEY);
  if (!rawValue) {
    return false;
  }

  const dismissedAt = Number(rawValue);
  if (!Number.isFinite(dismissedAt)) {
    return false;
  }

  return now - dismissedAt < INSTALL_DISMISSAL_COOLDOWN_MS;
}

export function recordInstallDismissal(
  storage: Pick<StorageLike, 'setItem'>,
  now: number,
): void {
  storage.setItem(INSTALL_DISMISSAL_STORAGE_KEY, String(now));
}

export function isIosLike(navigatorLike: NavigatorLike): boolean {
  const userAgent = navigatorLike.userAgent;
  return (
    /iPad|iPhone|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && (navigatorLike.maxTouchPoints ?? 0) > 1)
  );
}

export function isStandaloneDisplay(
  navigatorLike: NavigatorLike,
  displayMode: DisplayModeLike,
): boolean {
  return Boolean(navigatorLike.standalone) || displayMode.matches;
}

export function shouldShowIosInstallGuidance({
  canUseNativePrompt,
  dismissed,
  isIos,
  isStandalone,
}: {
  readonly canUseNativePrompt: boolean;
  readonly dismissed: boolean;
  readonly isIos: boolean;
  readonly isStandalone: boolean;
}): boolean {
  return isIos && !isStandalone && !canUseNativePrompt && !dismissed;
}
