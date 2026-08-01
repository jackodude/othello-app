export type PushPermissionState =
  | 'unsupported'
  | 'not-enabled'
  | 'enabled'
  | 'blocked';

export type PushBrowserPermission = 'default' | 'denied' | 'granted';
export type PushProvider = 'apple' | 'google-fcm' | 'mozilla' | 'other';

interface StorageLike {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem: (key: string) => void;
}

interface PushSubscriptionJsonLike {
  readonly endpoint?: string | null;
  readonly keys?: {
    readonly p256dh?: string | null;
    readonly auth?: string | null;
  } | null;
}

export const GLOBAL_PUSH_ENDPOINT_KEY = 'othello.pushEndpoint';

export function getStoredPushEndpoint(storage: Pick<StorageLike, 'getItem'>): string | null {
  return storage.getItem(GLOBAL_PUSH_ENDPOINT_KEY);
}

export function storePushEndpoint(
  storage: Pick<StorageLike, 'setItem'>,
  endpoint: string,
): void {
  storage.setItem(GLOBAL_PUSH_ENDPOINT_KEY, endpoint);
}

export function removeStoredPushEndpoint(storage: Pick<StorageLike, 'removeItem'>): void {
  storage.removeItem(GLOBAL_PUSH_ENDPOINT_KEY);
}

export function getPushPermissionState({
  isSupported,
  permission,
  hasStoredEndpoint,
  hasBrowserSubscription = hasStoredEndpoint,
}: {
  readonly isSupported: boolean;
  readonly permission: PushBrowserPermission;
  readonly hasStoredEndpoint: boolean;
  readonly hasBrowserSubscription?: boolean;
}): PushPermissionState {
  if (!isSupported) {
    return 'unsupported';
  }
  if (permission === 'denied') {
    return 'blocked';
  }
  return permission === 'granted' && (hasStoredEndpoint || hasBrowserSubscription)
    ? 'enabled'
    : 'not-enabled';
}

export function classifyPushProvider(endpoint: string | null): PushProvider | null {
  if (!endpoint) {
    return null;
  }

  const hostnameMatch = /^https:\/\/([^/?#]+)/iu.exec(endpoint);
  if (!hostnameMatch) {
    return null;
  }

  const hostname = hostnameMatch[1].toLowerCase();
  if (
    hostname === 'web.push.apple.com' ||
    hostname.endsWith('.push.apple.com') ||
    (hostname.includes('apple') && hostname.includes('push'))
  ) {
    return 'apple';
  }
  if (hostname.includes('fcm.googleapis.com') || hostname.includes('googleapis.com')) {
    return 'google-fcm';
  }
  if (hostname.includes('mozilla.com')) {
    return 'mozilla';
  }
  return 'other';
}

export function formatPushProvider(provider: PushProvider | null): string {
  switch (provider) {
    case 'apple':
      return 'Apple Web Push';
    case 'google-fcm':
      return 'Google FCM';
    case 'mozilla':
      return 'Mozilla Push';
    case 'other':
      return 'Other push service';
    default:
      return 'Unknown';
  }
}

export function hasCompletePushSubscription(
  subscription: PushSubscriptionJsonLike | null | undefined,
): subscription is PushSubscriptionJsonLike & {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
} {
  return Boolean(
    subscription &&
      typeof subscription.endpoint === 'string' &&
      subscription.endpoint.startsWith('https://') &&
      subscription.keys &&
      typeof subscription.keys.p256dh === 'string' &&
      subscription.keys.p256dh.length > 0 &&
      typeof subscription.keys.auth === 'string' &&
      subscription.keys.auth.length > 0,
  );
}

export function sanitizePushError(error: unknown): string {
  if (!(error instanceof Error) || !error.message) {
    return 'Push operation failed.';
  }

  return error.message
    .replace(/https:\/\/[^\s")]+/giu, '[push endpoint]')
    .replace(/[A-Za-z0-9_-]{24,}/gu, '[redacted]');
}

export function urlBase64ToArrayBuffer(value: string): ArrayBuffer {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = `${value}${padding}`.replaceAll('-', '+').replaceAll('_', '/');
  const globalObject = globalThis as typeof globalThis & {
    readonly atob: (data: string) => string;
  };
  const rawData = globalObject.atob(base64);
  const output = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    output[index] = rawData.charCodeAt(index);
  }

  return output.buffer;
}

export function isPushSupported(): boolean {
  const globalObject = globalThis as typeof globalThis & {
    readonly navigator?: unknown;
    readonly PushManager?: unknown;
    readonly Notification?: unknown;
  };

  return (
    typeof globalObject.navigator === 'object' &&
    globalObject.navigator !== null &&
    'serviceWorker' in globalObject.navigator &&
    'PushManager' in globalObject &&
    'Notification' in globalObject
  );
}
