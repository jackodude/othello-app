import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GAME_PREFERENCES,
  GAME_PREFERENCES_STORAGE_KEY,
  loadGamePreferences,
  parseGamePreferences,
  saveGamePreferences,
  shouldShowVisualLegalMoves,
} from './gamePreferences';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('game preferences', () => {
  it('uses default values when stored data is absent', () => {
    expect(parseGamePreferences(null)).toEqual(DEFAULT_GAME_PREFERENCES);
  });

  it('loads and persists preferences', () => {
    const storage = new MemoryStorage();
    const preferences = {
      highlightLastMove: false,
      animateDiscChanges: false,
      showLegalMoveIndicators: false,
    };

    saveGamePreferences(storage, preferences);

    expect(storage.getItem(GAME_PREFERENCES_STORAGE_KEY)).toBe(
      JSON.stringify(preferences),
    );
    expect(loadGamePreferences(storage)).toEqual(preferences);
  });

  it('falls back safely when stored data is invalid', () => {
    expect(parseGamePreferences('not json')).toEqual(DEFAULT_GAME_PREFERENCES);
    expect(parseGamePreferences(JSON.stringify({ highlightLastMove: 'no' }))).toEqual(
      DEFAULT_GAME_PREFERENCES,
    );
  });

  it('hides visual legal moves without changing playability input', () => {
    expect(
      shouldShowVisualLegalMoves(true, {
        ...DEFAULT_GAME_PREFERENCES,
        showLegalMoveIndicators: false,
      }),
    ).toBe(false);
    expect(shouldShowVisualLegalMoves(false, DEFAULT_GAME_PREFERENCES)).toBe(false);
  });
});
