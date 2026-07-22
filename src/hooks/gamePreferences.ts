export interface GamePreferences {
  readonly highlightLastMove: boolean;
  readonly animateDiscChanges: boolean;
  readonly showLegalMoveIndicators: boolean;
}

export const GAME_PREFERENCES_STORAGE_KEY = 'othello.gamePreferences';

export const DEFAULT_GAME_PREFERENCES: GamePreferences = {
  highlightLastMove: false,
  animateDiscChanges: true,
  showLegalMoveIndicators: true,
};

interface StorageLike {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

export function parseGamePreferences(value: string | null): GamePreferences {
  if (!value) {
    return DEFAULT_GAME_PREFERENCES;
  }

  try {
    const parsed = JSON.parse(value) as Partial<GamePreferences>;

    return {
      highlightLastMove: isBoolean(parsed.highlightLastMove)
        ? parsed.highlightLastMove
        : DEFAULT_GAME_PREFERENCES.highlightLastMove,
      animateDiscChanges: isBoolean(parsed.animateDiscChanges)
        ? parsed.animateDiscChanges
        : DEFAULT_GAME_PREFERENCES.animateDiscChanges,
      showLegalMoveIndicators: isBoolean(parsed.showLegalMoveIndicators)
        ? parsed.showLegalMoveIndicators
        : DEFAULT_GAME_PREFERENCES.showLegalMoveIndicators,
    };
  } catch {
    return DEFAULT_GAME_PREFERENCES;
  }
}

export function loadGamePreferences(storage: StorageLike): GamePreferences {
  return parseGamePreferences(storage.getItem(GAME_PREFERENCES_STORAGE_KEY));
}

export function saveGamePreferences(
  storage: StorageLike,
  preferences: GamePreferences,
): void {
  storage.setItem(GAME_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
}

export function shouldShowVisualLegalMoves(
  canShowLegalMoves: boolean,
  preferences: GamePreferences,
): boolean {
  return canShowLegalMoves && preferences.showLegalMoveIndicators;
}
