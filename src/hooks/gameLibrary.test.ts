import { describe, expect, it } from 'vitest';

import { createInitialGameState } from '../game';
import {
  addSavedJoinCode,
  calculateGameProgress,
  deriveMatchStats,
  deriveRematchInboxItem,
  deriveRematchInboxItems,
  filterSavedGameCards,
  GAME_LIBRARY_FILTER_KEY,
  getLibraryStatusLabel,
  INVITATION_PREFIX,
  isCompletedGame,
  isInProgressGame,
  orderSavedGameCards,
  PLAYER_TOKEN_PREFIX,
  readGameLibraryFilter,
  readSavedJoinCodes,
  removeSavedGameFromDevice,
  SAVED_JOIN_CODES_KEY,
  writeGameLibraryFilter,
} from './gameLibrary';
import type { SavedGameCard } from './gameLibrary';

function card(
  joinCode: string,
  overrides: Partial<SavedGameCard> = {},
): SavedGameCard {
  return {
    joinCode,
    state: createInitialGameState(),
    playerColor: 'black',
    opponentJoined: true,
    opponentName: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    progress: 0,
    ...overrides,
  };
}

function finishedCard(
  joinCode: string,
  playerColor: 'black' | 'white',
  winner: 'black' | 'white' | 'draw',
  updatedAt: string,
  overrides: Partial<SavedGameCard> = {},
): SavedGameCard {
  const state = createInitialGameState();
  return card(joinCode, {
    state: { ...state, status: 'finished' },
    playerColor,
    winner,
    updatedAt,
    ...overrides,
  });
}

describe('game library helpers', () => {
  it('calculates progress from moves played and finishes at 100 percent', () => {
    const state = createInitialGameState();

    expect(calculateGameProgress(state)).toBe(0);

    const board = state.board.map((row) => [...row]);
    board[2][3] = 'black';
    expect(calculateGameProgress({ ...state, board })).toBe(2);
    expect(calculateGameProgress({ ...state, status: 'finished' })).toBe(100);
    expect(calculateGameProgress({ ...state, status: 'finished' }, 'forfeit')).toBe(0);
  });

  it('orders games by actionable unfinished games, then active, then completed', () => {
    const yourTurn = card('YOUR01', {
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const newerOtherTurn = card('OTHER1', {
      state: { ...createInitialGameState(), currentPlayer: 'white' },
      updatedAt: '2026-01-03T00:00:00.000Z',
    });
    const completed = card('DONE01', {
      state: { ...createInitialGameState(), status: 'finished' },
      updatedAt: '2026-01-04T00:00:00.000Z',
    });

    expect(orderSavedGameCards([completed, newerOtherTurn, yourTurn]).map(
      (game) => game.joinCode,
    )).toEqual(['YOUR01', 'OTHER1', 'DONE01']);
  });

  it('labels library cards with relative opponent names', () => {
    expect(getLibraryStatusLabel(card('ABCDEF'))).toBe('Your turn');
    expect(
      getLibraryStatusLabel(
        card('ABCDEF', {
          state: { ...createInitialGameState(), currentPlayer: 'white' },
          opponentName: 'Grace',
        }),
      ),
    ).toBe("Grace's turn");
    expect(
      getLibraryStatusLabel(
        card('ABCDEF', {
          state: { ...createInitialGameState(), status: 'finished' },
          opponentName: 'Grace',
          endedReason: 'forfeit',
          forfeitedBy: 'white',
        }),
      ),
    ).toBe('Grace forfeited');
    expect(
      getLibraryStatusLabel(
        card('ABCDEF', {
          state: { ...createInitialGameState(), status: 'finished' },
          endedReason: 'cancelled',
        }),
      ),
    ).toBe('Game cancelled');
  });

  it('stores saved join codes without duplicates and tolerates invalid storage', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    addSavedJoinCode(storage, 'abcdef');
    addSavedJoinCode(storage, 'ABCDEF');
    addSavedJoinCode(storage, 'ghjklm');

    expect(JSON.parse(values.get(SAVED_JOIN_CODES_KEY) ?? '[]')).toEqual([
      'GHJKLM',
      'ABCDEF',
    ]);
    expect(readSavedJoinCodes(storage)).toEqual(['GHJKLM', 'ABCDEF']);
    expect(
      readSavedJoinCodes({
        getItem: () => {
          throw new Error('storage unavailable');
        },
      }),
    ).toEqual([]);
  });

  it('filters library cards and persists the selected filter safely', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const waiting = card('WAIT01', { opponentJoined: false });
    const playing = card('PLAY01');
    const completed = card('DONE01', {
      state: { ...createInitialGameState(), status: 'finished' },
    });
    const forfeited = card('FORFIT', {
      state: { ...createInitialGameState(), status: 'finished' },
      endedReason: 'forfeit',
      forfeitedBy: 'white',
      progress: 7,
    });
    const cancelled = card('CANCEL', {
      state: { ...createInitialGameState(), status: 'finished' },
      endedReason: 'cancelled',
      winner: null,
    });

    expect(isInProgressGame(waiting)).toBe(true);
    expect(isInProgressGame(playing)).toBe(true);
    expect(isCompletedGame(completed)).toBe(true);
    expect(isCompletedGame(forfeited)).toBe(true);
    expect(isCompletedGame(cancelled)).toBe(true);
    expect(readGameLibraryFilter(storage)).toBe('in-progress');
    writeGameLibraryFilter(storage, 'completed');
    expect(values.get(GAME_LIBRARY_FILTER_KEY)).toBe('completed');
    expect(readGameLibraryFilter(storage)).toBe('completed');
    values.set(GAME_LIBRARY_FILTER_KEY, 'nonsense');
    expect(readGameLibraryFilter(storage)).toBe('in-progress');
    expect(filterSavedGameCards([waiting, playing, completed, forfeited, cancelled], 'in-progress')).toEqual([
      waiting,
      playing,
    ]);
    expect(filterSavedGameCards([waiting, playing, completed, forfeited, cancelled], 'completed')).toEqual([
      completed,
      forfeited,
      cancelled,
    ]);
    expect(filterSavedGameCards([waiting, completed], 'all')).toEqual([
      waiting,
      completed,
    ]);
  });

  it('removes only one completed game from local device history', () => {
    const values = new Map<string, string>([
      [SAVED_JOIN_CODES_KEY, JSON.stringify(['DONE01', 'PLAY01'])],
      [`${PLAYER_TOKEN_PREFIX}DONE01`, 'done-token'],
      [`${PLAYER_TOKEN_PREFIX}PLAY01`, 'play-token'],
      [`${INVITATION_PREFIX}DONE01`, 'DONE01:invite'],
      ['othello.playerProfile', JSON.stringify({ displayName: 'Alex' })],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => {
        values.delete(key);
      },
    };

    removeSavedGameFromDevice(storage, 'done01');

    expect(readSavedJoinCodes(storage)).toEqual(['PLAY01']);
    expect(values.has(`${PLAYER_TOKEN_PREFIX}DONE01`)).toBe(false);
    expect(values.has(`${INVITATION_PREFIX}DONE01`)).toBe(false);
    expect(values.get(`${PLAYER_TOKEN_PREFIX}PLAY01`)).toBe('play-token');
    expect(values.get('othello.playerProfile')).toBe(
      JSON.stringify({ displayName: 'Alex' }),
    );
    expect(() =>
      removeSavedGameFromDevice({
        getItem: () => {
          throw new Error('storage unavailable');
        },
        setItem: () => {
          throw new Error('storage unavailable');
        },
        removeItem: () => {
          throw new Error('storage unavailable');
        },
      }, 'DONE01'),
    ).not.toThrow();
  });

  it('derives opponent and requester rematch inbox cards from completed parents', () => {
    const opponentRequest = card('PARENT', {
      state: { ...createInitialGameState(), status: 'finished' },
      playerColor: 'white',
      opponentName: 'Alex',
      rematch: {
        joinCode: 'CHILD1',
        requestedBy: 'black',
        requestedAt: '2026-01-05T00:00:00.000Z',
        waiting: true,
        accepted: false,
      },
    });
    const selfRequest = card('OLDER1', {
      state: { ...createInitialGameState(), status: 'finished' },
      playerColor: 'black',
      opponentName: 'Sam',
      rematch: {
        joinCode: 'CHILD2',
        requestedBy: 'black',
        requestedAt: '2026-01-04T00:00:00.000Z',
        waiting: true,
        accepted: false,
      },
    });

    expect(deriveRematchInboxItem(opponentRequest)).toEqual({
      parentCode: 'PARENT',
      childCode: 'CHILD1',
      opponentName: 'Alex',
      requestedBy: 'opponent',
      requiresAcceptance: true,
      requestedAt: '2026-01-05T00:00:00.000Z',
    });
    expect(deriveRematchInboxItem(selfRequest)).toEqual({
      parentCode: 'OLDER1',
      childCode: 'CHILD2',
      opponentName: 'Sam',
      requestedBy: 'self',
      requiresAcceptance: false,
      requestedAt: '2026-01-04T00:00:00.000Z',
    });
  });

  it('uses clean fallbacks and excludes accepted, missing, unfinished, and cancelled rematches', () => {
    const fallback = card('PARENT', {
      state: { ...createInitialGameState(), status: 'finished' },
      playerColor: 'white',
      opponentName: null,
      rematch: {
        joinCode: 'CHILD1',
        requestedBy: 'black',
        waiting: true,
        accepted: false,
      },
    });

    expect(deriveRematchInboxItem(fallback)?.opponentName).toBe('your opponent');
    expect(deriveRematchInboxItem(card('NONE01'))).toBeNull();
    expect(
      deriveRematchInboxItem(
        card('ACTIVE', {
          rematch: {
            joinCode: 'CHILD2',
            requestedBy: 'black',
            waiting: true,
            accepted: false,
          },
        }),
      ),
    ).toBeNull();
    expect(
      deriveRematchInboxItem(
        card('ACCEPT', {
          state: { ...createInitialGameState(), status: 'finished' },
          rematch: {
            joinCode: 'CHILD3',
            requestedBy: 'black',
            requestedAt: '2026-01-05T00:00:00.000Z',
            waiting: false,
            accepted: true,
          },
        }),
      ),
    ).toBeNull();
    expect(
      deriveRematchInboxItem(
        card('CANCEL', {
          state: { ...createInitialGameState(), status: 'finished' },
          endedReason: 'cancelled',
          rematch: {
            joinCode: 'CHILD4',
            requestedBy: 'black',
            waiting: true,
            accepted: false,
          },
        }),
      ),
    ).toBeNull();
  });

  it('orders rematch inbox cards by required acceptance and newest request', () => {
    const cards = [
      card('WAIT01', {
        state: { ...createInitialGameState(), status: 'finished' },
        playerColor: 'black',
        opponentName: 'Riley',
        rematch: {
          joinCode: 'CHILD1',
          requestedBy: 'black',
          requestedAt: '2026-01-06T00:00:00.000Z',
          waiting: true,
          accepted: false,
        },
      }),
      card('ACPT01', {
        state: { ...createInitialGameState(), status: 'finished' },
        playerColor: 'white',
        opponentName: 'Morgan',
        rematch: {
          joinCode: 'CHILD2',
          requestedBy: 'black',
          requestedAt: '2026-01-04T00:00:00.000Z',
          waiting: true,
          accepted: false,
        },
      }),
      card('ACPT02', {
        state: { ...createInitialGameState(), status: 'finished' },
        playerColor: 'black',
        opponentName: 'Casey',
        rematch: {
          joinCode: 'CHILD3',
          requestedBy: 'white',
          requestedAt: '2026-01-05T00:00:00.000Z',
          waiting: true,
          accepted: false,
        },
      }),
    ];

    expect(deriveRematchInboxItems(cards).map((item) => item.parentCode)).toEqual([
      'ACPT02',
      'ACPT01',
      'WAIT01',
    ]);
  });

  it('derives empty match stats when there are no completed games', () => {
    expect(deriveMatchStats([card('WAIT01', { opponentJoined: false }), card('PLAY01')])).toEqual({
      lastCompletedMatch: null,
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      winPercentage: '0.0',
    });
  });

  it('derives match stats for one win and one loss', () => {
    expect(
      deriveMatchStats([
        finishedCard('WIN001', 'black', 'black', '2026-01-03T00:00:00.000Z', {
          opponentName: 'Alex',
        }),
      ]),
    ).toMatchObject({
      lastCompletedMatch: {
        opponentName: 'Alex',
        result: 'win',
      },
      gamesPlayed: 1,
      wins: 1,
      losses: 0,
      winPercentage: '100.0',
    });

    expect(
      deriveMatchStats([
        finishedCard('LOSS01', 'white', 'black', '2026-01-03T00:00:00.000Z'),
      ]),
    ).toMatchObject({
      lastCompletedMatch: {
        opponentName: 'Opponent',
        result: 'loss',
      },
      gamesPlayed: 1,
      wins: 0,
      losses: 1,
      winPercentage: '0.0',
    });
  });

  it('counts forfeited wins and losses while excluding cancelled and active games', () => {
    const forfeitedWin = finishedCard(
      'FORWIN',
      'white',
      'white',
      '2026-01-02T00:00:00.000Z',
      {
        endedReason: 'forfeit',
        forfeitedBy: 'black',
      },
    );
    const forfeitedLoss = finishedCard(
      'FORLOS',
      'black',
      'white',
      '2026-01-03T00:00:00.000Z',
      {
        endedReason: 'forfeit',
        forfeitedBy: 'black',
      },
    );
    const cancelled = finishedCard(
      'CANCEL',
      'black',
      'draw',
      '2026-01-04T00:00:00.000Z',
      {
        endedReason: 'cancelled',
      },
    );

    const stats = deriveMatchStats([forfeitedWin, cancelled, card('ACTIVE'), forfeitedLoss]);

    expect(stats.gamesPlayed).toBe(2);
    expect(stats.wins).toBe(1);
    expect(stats.losses).toBe(1);
    expect(stats.winPercentage).toBe('50.0');
    expect(stats.lastCompletedMatch?.result).toBe('loss');
  });

  it('selects the newest completed match as the last completed match', () => {
    const older = finishedCard('OLDER1', 'black', 'black', '2026-01-01T00:00:00.000Z', {
      opponentName: 'Older',
    });
    const newer = finishedCard('NEWER1', 'black', 'white', '2026-01-05T00:00:00.000Z', {
      opponentName: 'Newer',
    });

    const stats = deriveMatchStats([newer, older]);

    expect(stats.lastCompletedMatch).toMatchObject({
      opponentName: 'Newer',
      result: 'loss',
      finalScore: '2-2',
    });
  });
});
