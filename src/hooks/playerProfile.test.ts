import { describe, expect, it } from 'vitest';

import {
  loadPlayerProfile,
  normalizeDisplayName,
  PLAYER_PROFILE_STORAGE_KEY,
  savePlayerProfile,
} from './playerProfile';

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) {
    values.set(PLAYER_PROFILE_STORAGE_KEY, initial);
  }

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    values,
  };
}

describe('player profile preferences', () => {
  it('normalizes display names within the supported length', () => {
    expect(normalizeDisplayName('  Ada   Lovelace  ')).toBe('Ada Lovelace');
    expect(normalizeDisplayName('')).toBeNull();
    expect(normalizeDisplayName('x'.repeat(25))).toBeNull();
  });

  it('loads absent or invalid stored profiles safely', () => {
    expect(loadPlayerProfile(memoryStorage()).displayName).toBeNull();
    expect(loadPlayerProfile(memoryStorage('{')).displayName).toBeNull();
    expect(
      loadPlayerProfile(
        memoryStorage(JSON.stringify({ displayName: 'x'.repeat(25) })),
      ).displayName,
    ).toBeNull();
  });

  it('persists and reloads the local display name', () => {
    const storage = memoryStorage();

    savePlayerProfile(storage, { displayName: 'Grace Hopper' });

    expect(loadPlayerProfile(storage).displayName).toBe('Grace Hopper');
  });

  it('ignores storage failures', () => {
    const brokenStorage = {
      getItem: () => {
        throw new Error('storage unavailable');
      },
      setItem: () => {
        throw new Error('storage unavailable');
      },
    };

    expect(loadPlayerProfile(brokenStorage).displayName).toBeNull();
    expect(() =>
      savePlayerProfile(brokenStorage, { displayName: 'Ada' }),
    ).not.toThrow();
  });
});
