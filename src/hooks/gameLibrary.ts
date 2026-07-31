import { getGameResult, getScores } from '../game';
import type { Board, GameResult, GameState, Player } from '../game';

export interface SavedGameCard {
  readonly joinCode: string;
  readonly state: GameState;
  readonly playerColor: Player;
  readonly opponentJoined: boolean;
  readonly opponentName: string | null;
  readonly updatedAt: string;
  readonly progress: number;
  readonly winner?: GameResult | null;
  readonly endedReason?: 'normal' | 'forfeit' | 'cancelled';
  readonly forfeitedBy?: Player | null;
  readonly rematch?: {
    readonly joinCode: string;
    readonly requestedBy: Player;
    readonly requestedAt?: string | null;
    readonly waiting: boolean;
    readonly accepted: boolean;
  } | null;
}

interface StorageLike {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem?: (key: string) => void;
}

export const SAVED_JOIN_CODES_KEY = 'othello.savedJoinCodes';
export const GAME_LIBRARY_FILTER_KEY = 'othello.gameLibraryFilter';
export const PLAYER_TOKEN_PREFIX = 'othello.playerToken.';
export const INVITATION_PREFIX = 'othello.invitation.';
export type GameLibraryFilter = 'in-progress' | 'completed' | 'all';

export interface RematchInboxItem {
  readonly parentCode: string;
  readonly childCode: string;
  readonly opponentName: string;
  readonly requestedBy: 'self' | 'opponent';
  readonly requiresAcceptance: boolean;
  readonly requestedAt: string | null;
}

export interface MatchStats {
  readonly lastCompletedMatch: {
    readonly opponentName: string;
    readonly result: 'win' | 'loss' | 'draw';
    readonly finalScore: string;
    readonly finishedDate: string;
  } | null;
  readonly gamesPlayed: number;
  readonly wins: number;
  readonly losses: number;
  readonly winPercentage: string;
}

export function calculateGameProgress(
  state: GameState,
  endedReason: 'normal' | 'forfeit' | 'cancelled' = 'normal',
): number {
  if (
    state.status === 'finished' &&
    endedReason !== 'forfeit' &&
    endedReason !== 'cancelled'
  ) {
    return 100;
  }

  const occupiedSquares = countOccupiedSquares(state.board);
  const movesPlayed = Math.max(0, occupiedSquares - 4);
  return Math.max(0, Math.min(100, Math.round((movesPlayed / 60) * 100)));
}

export function countOccupiedSquares(board: Board): number {
  return board.reduce(
    (total, row) => total + row.filter((cell) => cell !== null).length,
    0,
  );
}

export function readSavedJoinCodes(storage: Pick<StorageLike, 'getItem'>): string[] {
  try {
    const storedValue = storage.getItem(SAVED_JOIN_CODES_KEY);
    if (!storedValue) {
      return [];
    }

    const parsed = JSON.parse(storedValue) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((code): code is string => typeof code === 'string')
      : [];
  } catch {
    return [];
  }
}

export function writeSavedJoinCodes(
  storage: Pick<StorageLike, 'setItem'>,
  joinCodes: readonly string[],
): void {
  try {
    storage.setItem(SAVED_JOIN_CODES_KEY, JSON.stringify([...new Set(joinCodes)]));
  } catch {
    // Local library is best-effort; per-game credentials remain the authority.
  }
}

export function addSavedJoinCode(
  storage: StorageLike,
  joinCode: string,
): void {
  const normalizedCode = joinCode.trim().toUpperCase();
  if (!normalizedCode) {
    return;
  }

  writeSavedJoinCodes(storage, [
    normalizedCode,
    ...readSavedJoinCodes(storage).filter((code) => code !== normalizedCode),
  ]);
}

export function getLibraryStatusLabel(card: SavedGameCard): string {
  const opponentName = card.opponentName || 'Opponent';
  if (!card.opponentJoined) {
    return 'Waiting for opponent';
  }

  if (card.state.status === 'finished') {
    if (card.endedReason === 'cancelled') {
      return 'Game cancelled';
    }
    if (card.endedReason === 'forfeit') {
      return card.forfeitedBy === card.playerColor
        ? 'You forfeited'
        : `${opponentName} forfeited`;
    }

    return formatLibraryResult(
      card.winner ?? getGameResult(getScores(card.state.board)),
      card.playerColor,
      opponentName,
    );
  }

  return card.state.currentPlayer === card.playerColor
    ? 'Your turn'
    : `${opponentName}'s turn`;
}

export function readGameLibraryFilter(
  storage: Pick<StorageLike, 'getItem'>,
): GameLibraryFilter {
  try {
    const value = storage.getItem(GAME_LIBRARY_FILTER_KEY);
    return value === 'completed' || value === 'all' ? value : 'in-progress';
  } catch {
    return 'in-progress';
  }
}

export function writeGameLibraryFilter(
  storage: Pick<StorageLike, 'setItem'>,
  filter: GameLibraryFilter,
): void {
  try {
    storage.setItem(GAME_LIBRARY_FILTER_KEY, filter);
  } catch {
    // Filter preference is cosmetic; library data remains available.
  }
}

export function filterSavedGameCards(
  cards: readonly SavedGameCard[],
  filter: GameLibraryFilter,
): SavedGameCard[] {
  if (filter === 'all') {
    return [...cards];
  }

  return cards.filter((card) =>
    filter === 'completed'
      ? isCompletedGame(card)
      : isInProgressGame(card),
  );
}

export function isCompletedGame(card: SavedGameCard): boolean {
  return card.state.status === 'finished';
}

export function isInProgressGame(card: SavedGameCard): boolean {
  return !isCompletedGame(card);
}

export function removeSavedGameFromDevice(
  storage: StorageLike,
  joinCode: string,
): void {
  const normalizedCode = joinCode.trim().toUpperCase();
  if (!normalizedCode) {
    return;
  }

  writeSavedJoinCodes(
    storage,
    readSavedJoinCodes(storage).filter((code) => code !== normalizedCode),
  );

  try {
    storage.removeItem?.(`${PLAYER_TOKEN_PREFIX}${normalizedCode}`);
    storage.removeItem?.(`${INVITATION_PREFIX}${normalizedCode}`);
  } catch {
    // Local cleanup is best-effort; do not damage the rest of the library.
  }
}

export function deriveRematchInboxItems(
  cards: readonly SavedGameCard[],
): RematchInboxItem[] {
  return cards
    .map(deriveRematchInboxItem)
    .filter((item): item is RematchInboxItem => item !== null)
    .sort(orderRematchInboxItems);
}

export function deriveRematchInboxItem(
  card: SavedGameCard,
): RematchInboxItem | null {
  const rematch = card.rematch;
  if (
    !rematch ||
    !rematch.waiting ||
    rematch.accepted ||
    !isCompletedGame(card) ||
    card.endedReason === 'cancelled'
  ) {
    return null;
  }

  const requestedBySelf = rematch.requestedBy === card.playerColor;
  return {
    parentCode: card.joinCode,
    childCode: rematch.joinCode,
    opponentName: card.opponentName || 'your opponent',
    requestedBy: requestedBySelf ? 'self' : 'opponent',
    requiresAcceptance: !requestedBySelf,
    requestedAt: rematch.requestedAt ?? null,
  };
}

function orderRematchInboxItems(
  left: RematchInboxItem,
  right: RematchInboxItem,
): number {
  if (left.requiresAcceptance !== right.requiresAcceptance) {
    return left.requiresAcceptance ? -1 : 1;
  }

  return (right.requestedAt ?? '').localeCompare(left.requestedAt ?? '');
}

export function deriveMatchStats(cards: readonly SavedGameCard[]): MatchStats {
  const completedGames = cards
    .filter(isMatchStatsGame)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const results = completedGames.map((card) => getPlayerResult(card));
  const wins = results.filter((result) => result === 'win').length;
  const losses = results.filter((result) => result === 'loss').length;
  const gamesPlayed = completedGames.length;

  return {
    lastCompletedMatch: completedGames[0]
      ? {
          opponentName: completedGames[0].opponentName || 'Opponent',
          result: getPlayerResult(completedGames[0]),
          finalScore: formatFinalScore(completedGames[0]),
          finishedDate: formatFinishedDate(completedGames[0].updatedAt),
        }
      : null,
    gamesPlayed,
    wins,
    losses,
    winPercentage:
      gamesPlayed === 0 ? '0.0' : ((wins / gamesPlayed) * 100).toFixed(1),
  };
}

function isMatchStatsGame(card: SavedGameCard): boolean {
  return isCompletedGame(card) && card.endedReason !== 'cancelled';
}

function getPlayerResult(card: SavedGameCard): 'win' | 'loss' | 'draw' {
  const result = card.winner ?? getGameResult(getScores(card.state.board));
  if (result === 'draw') {
    return 'draw';
  }

  return result === card.playerColor ? 'win' : 'loss';
}

function formatFinalScore(card: SavedGameCard): string {
  const scores = getScores(card.state.board);
  return card.playerColor === 'black'
    ? `${scores.black}-${scores.white}`
    : `${scores.white}-${scores.black}`;
}

function formatFinishedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatLibraryResult(
  result: GameResult,
  playerColor: Player,
  opponentName: string,
): string {
  if (result === 'draw') {
    return `Draw with ${opponentName}`;
  }

  return result === playerColor ? `You defeated ${opponentName}` : `${opponentName} won`;
}

export function orderSavedGameCards(cards: readonly SavedGameCard[]): SavedGameCard[] {
  return [...cards].sort((left, right) => {
    const groupDifference = getCardGroup(left) - getCardGroup(right);
    if (groupDifference !== 0) {
      return groupDifference;
    }

    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

function getCardGroup(card: SavedGameCard): number {
  if (isCompletedGame(card)) {
    return 2;
  }

  return card.opponentJoined && card.state.currentPlayer === card.playerColor ? 0 : 1;
}
