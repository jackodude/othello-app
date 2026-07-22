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

const PUSH_ENDPOINT_PREFIX = 'othello.pushEndpoint.';

export function pushEndpointKey(joinCode: string): string {
  return `${PUSH_ENDPOINT_PREFIX}${joinCode.trim().toUpperCase()}`;
}

export function getStoredPushEndpoint(
  storage: Pick<StorageLike, 'getItem'>,
  joinCode: string | null,
): string | null {
  return joinCode ? storage.getItem(pushEndpointKey(joinCode)) : null;
}

export function storePushEndpoint(
  storage: Pick<StorageLike, 'setItem'>,
  joinCode: string,
  endpoint: string,
): void {
  storage.setItem(pushEndpointKey(joinCode), endpoint);
}

export function removeStoredPushEndpoint(
  storage: Pick<StorageLike, 'removeItem'>,
  joinCode: string,
): void {
  storage.removeItem(pushEndpointKey(joinCode));
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
