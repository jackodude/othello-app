import { describe, expect, it } from 'vitest';

import {
  classifyPushProvider,
  formatPushProvider,
  GLOBAL_PUSH_ENDPOINT_KEY,
  getPushPermissionState,
  getStoredPushEndpoint,
  hasCompletePushSubscription,
  removeStoredPushEndpoint,
  sanitizePushError,
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
    expect(
      getPushPermissionState({
        isSupported: true,
        permission: 'granted',
        hasStoredEndpoint: false,
        hasBrowserSubscription: true,
      }),
    ).toBe('enabled');
  });

  it('classifies common push providers without exposing endpoints', () => {
    expect(classifyPushProvider('https://web.push.apple.com/Q123')).toBe('apple');
    expect(classifyPushProvider('https://updates.push.apple.com/Q123')).toBe('apple');
    expect(classifyPushProvider('https://fcm.googleapis.com/fcm/send/abc')).toBe(
      'google-fcm',
    );
    expect(classifyPushProvider('https://updates.push.services.mozilla.com/wpush/v2/abc'))
      .toBe('mozilla');
    expect(classifyPushProvider('not a url')).toBeNull();
    expect(formatPushProvider('apple')).toBe('Apple Web Push');
  });

  it('validates browser subscription JSON before registration', () => {
    expect(
      hasCompletePushSubscription({
        endpoint: 'https://web.push.apple.com/Q123',
        keys: { p256dh: 'p256dh', auth: 'auth' },
      }),
    ).toBe(true);
    expect(
      hasCompletePushSubscription({
        endpoint: 'https://web.push.apple.com/Q123',
        keys: { p256dh: '', auth: 'auth' },
      }),
    ).toBe(false);
    expect(hasCompletePushSubscription(null)).toBe(false);
  });

  it('sanitizes push errors before displaying diagnostics', () => {
    expect(
      sanitizePushError(
        new Error('Failed https://web.push.apple.com/very-secret-token ABCDEFGHIJKLMNOPQRSTUVWX'),
      ),
    ).toBe('Failed [push endpoint] [redacted]');
  });
});
