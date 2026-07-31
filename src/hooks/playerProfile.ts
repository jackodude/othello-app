export interface PlayerProfile {
  readonly displayName: string | null;
}

interface StorageLike {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
}

export const PLAYER_PROFILE_STORAGE_KEY = 'othello.playerProfile';
export const MAX_DISPLAY_NAME_LENGTH = 24;

export function normalizeDisplayName(value: string): string | null {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed || trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
    return null;
  }

  return trimmed;
}

export function loadPlayerProfile(storage: Pick<StorageLike, 'getItem'>): PlayerProfile {
  try {
    const storedValue = storage.getItem(PLAYER_PROFILE_STORAGE_KEY);
    if (!storedValue) {
      return { displayName: null };
    }

    const parsed = JSON.parse(storedValue) as { readonly displayName?: unknown };
    return typeof parsed.displayName === 'string'
      ? { displayName: normalizeDisplayName(parsed.displayName) }
      : { displayName: null };
  } catch {
    return { displayName: null };
  }
}

export function savePlayerProfile(
  storage: Pick<StorageLike, 'setItem'>,
  profile: PlayerProfile,
): void {
  try {
    storage.setItem(PLAYER_PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Storage can be unavailable in private or restricted contexts.
  }
}
