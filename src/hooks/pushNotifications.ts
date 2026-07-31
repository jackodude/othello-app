export type PushPermissionState =
  | 'unsupported'
  | 'not-enabled'
  | 'enabled'
  | 'blocked';

export type PushBrowserPermission = 'default' | 'denied' | 'granted';

interface StorageLike {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem: (key: string) => void;
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
}: {
  readonly isSupported: boolean;
  readonly permission: PushBrowserPermission;
  readonly hasStoredEndpoint: boolean;
}): PushPermissionState {
  if (!isSupported) {
    return 'unsupported';
  }
  if (permission === 'denied') {
    return 'blocked';
  }
  return permission === 'granted' && hasStoredEndpoint ? 'enabled' : 'not-enabled';
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
