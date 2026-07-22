import { describe, expect, it } from 'vitest';

import {
  getPushPermissionState,
  getStoredPushEndpoint,
  pushEndpointKey,
  removeStoredPushEndpoint,
  storePushEndpoint,
} from './pushNotifications';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe('push notification helpers', () => {
  it('scopes stored endpoints by normalized join code', () => {
    const storage = new MemoryStorage();

    expect(pushEndpointKey('abc123')).toBe('othello.pushEndpoint.ABC123');
    expect(getStoredPushEndpoint(storage, 'abc123')).toBeNull();

    storePushEndpoint(storage, 'abc123', 'https://push.example/sub');

    expect(getStoredPushEndpoint(storage, 'ABC123')).toBe('https://push.example/sub');

    removeStoredPushEndpoint(storage, 'ABC123');

    expect(getStoredPushEndpoint(storage, 'ABC123')).toBeNull();
  });

  it('derives permission state without requesting permission', () => {
    expect(
      getPushPermissionState({
        isSupported: false,
        permission: 'default',
        hasStoredEndpoint: false,
      }),
    ).toBe('unsupported');
    expect(
      getPushPermissionState({
        isSupported: true,
        permission: 'denied',
        hasStoredEndpoint: true,
      }),
    ).toBe('blocked');
    expect(
      getPushPermissionState({
        isSupported: true,
        permission: 'granted',
        hasStoredEndpoint: true,
      }),
    ).toBe('enabled');
    expect(
      getPushPermissionState({
        isSupported: true,
        permission: 'granted',
        hasStoredEndpoint: false,
      }),
    ).toBe('not-enabled');
  });
});
