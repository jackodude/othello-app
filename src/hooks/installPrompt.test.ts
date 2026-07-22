import { describe, expect, it } from 'vitest';

import {
  INSTALL_DISMISSAL_COOLDOWN_MS,
  INSTALL_DISMISSAL_STORAGE_KEY,
  isInstallDismissed,
  isIosLike,
  isStandaloneDisplay,
  recordInstallDismissal,
  shouldShowIosInstallGuidance,
} from './installPrompt';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('install prompt helpers', () => {
  it('persists dismissal with a cooldown', () => {
    const storage = new MemoryStorage();
    const now = 1000;

    expect(isInstallDismissed(storage, now)).toBe(false);
    recordInstallDismissal(storage, now);

    expect(storage.getItem(INSTALL_DISMISSAL_STORAGE_KEY)).toBe('1000');
    expect(isInstallDismissed(storage, now + 100)).toBe(true);
    expect(
      isInstallDismissed(storage, now + INSTALL_DISMISSAL_COOLDOWN_MS + 1),
    ).toBe(false);
  });

  it('ignores invalid dismissal data', () => {
    const storage = new MemoryStorage();
    storage.setItem(INSTALL_DISMISSAL_STORAGE_KEY, 'not-a-number');

    expect(isInstallDismissed(storage, 1000)).toBe(false);
  });

  it('detects iOS-like browsers and standalone display', () => {
    expect(isIosLike({ userAgent: 'Mozilla/5.0 (iPhone)' })).toBe(true);
    expect(isIosLike({ userAgent: 'Mozilla/5.0 (Macintosh)', maxTouchPoints: 5 })).toBe(
      true,
    );
    expect(isIosLike({ userAgent: 'Mozilla/5.0 (Windows NT)' })).toBe(false);

    expect(isStandaloneDisplay({ userAgent: '', standalone: true }, { matches: false })).toBe(
      true,
    );
    expect(isStandaloneDisplay({ userAgent: '' }, { matches: true })).toBe(true);
  });

  it('shows iOS guidance only when useful', () => {
    expect(
      shouldShowIosInstallGuidance({
        canUseNativePrompt: false,
        dismissed: false,
        isIos: true,
        isStandalone: false,
      }),
    ).toBe(true);
    expect(
      shouldShowIosInstallGuidance({
        canUseNativePrompt: true,
        dismissed: false,
        isIos: true,
        isStandalone: false,
      }),
    ).toBe(false);
  });
});
