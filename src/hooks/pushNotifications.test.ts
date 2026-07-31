import { describe, expect, it } from 'vitest';

import {
  GLOBAL_PUSH_ENDPOINT_KEY,
  getPushPermissionState,
  getStoredPushEndpoint,
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
  it('stores one global endpoint for the device', () => {
    const storage = new MemoryStorage();

    expect(GLOBAL_PUSH_ENDPOINT_KEY).toBe('othello.pushEndpoint');
    expect(getStoredPushEndpoint(storage)).toBeNull();

    storePushEndpoint(storage, 'https://push.example/sub');

    expect(getStoredPushEndpoint(storage)).toBe('https://push.example/sub');

    removeStoredPushEndpoint(storage);

    expect(getStoredPushEndpoint(storage)).toBeNull();
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
