import { describe, expect, it } from 'vitest';

import {
  applyMove,
  createInitialBoard,
  createInitialGameState,
  getAllFlips,
  getFlipsInDirection,
  getGameResult,
  getLegalMoves,
  getScores,
  isLegalMove,
  resolveTurnState,
} from './engine';
import type { Board, GameState } from './types';

function makeBoard(rows: string[]): Board {
  if (rows.length !== 8) {
    throw new Error('Board fixture must contain exactly 8 rows');
  }

  return rows.map((row) => {
    if (row.length !== 8) {
      throw new Error(`Each board row must contain exactly 8 cells: "${row}"`);
    }

    return [...row].map((symbol) => {
      if (symbol === '.') {
        return null;
      }
      if (symbol === 'B') {
        return 'black';
      }
      if (symbol === 'W') {
        return 'white';
      }
      throw new Error(`Invalid cell symbol: ${symbol}`);
    });
  });
}

describe('createInitialBoard', () => {
  it('sets up the standard opening position', () => {
    const board = createInitialBoard();

    expect(board[3][3]).toBe('white');
    expect(board[3][4]).toBe('black');
    expect(board[4][3]).toBe('black');
    expect(board[4][4]).toBe('white');
  });

  it('starts with 60 empty squares', () => {
    const board = createInitialBoard();
    const emptyCount = board.flat().filter((cell) => cell === null).length;

    expect(emptyCount).toBe(60);
  });
});

describe('createInitialGameState', () => {
  it('starts with black to move and four legal opening moves', () => {
    const state = createInitialGameState();

    expect(state.currentPlayer).toBe('black');
    expect(state.status).toBe('playing');
    expect(state.legalMoves).toHaveLength(4);
    expect(state.consecutivePasses).toBe(0);
  });
});

describe('getLegalMoves', () => {
  it('returns all legal moves for the opening position', () => {
    const board = createInitialBoard();
    const moves = getLegalMoves(board, 'black');

    expect(moves).toEqual(
      expect.arrayContaining([
        { row: 2, col: 3 },
        { row: 3, col: 2 },
        { row: 4, col: 5 },
        { row: 5, col: 4 },
      ]),
    );
    expect(moves).toHaveLength(4);
  });

  it('returns no legal moves on an empty board', () => {
    const board = makeBoard(Array(8).fill('........') as string[]);
    const moves = getLegalMoves(board, 'black');

    expect(moves).toHaveLength(0);
  });
});

describe('isLegalMove', () => {
  it('accepts legal opening moves', () => {
    const board = createInitialBoard();

    expect(isLegalMove(board, { row: 2, col: 3 }, 'black')).toBe(true);
    expect(isLegalMove(board, { row: 3, col: 2 }, 'black')).toBe(true);
  });

  it('rejects occupied squares', () => {
    const board = createInitialBoard();

    expect(isLegalMove(board, { row: 3, col: 3 }, 'black')).toBe(false);
  });

  it('rejects moves that do not flip any discs', () => {
    const board = createInitialBoard();

    expect(isLegalMove(board, { row: 0, col: 0 }, 'black')).toBe(false);
    expect(isLegalMove(board, { row: 2, col: 2 }, 'black')).toBe(false);
  });
});

describe('getFlipsInDirection', () => {
  it('flips horizontally to the right', () => {
    const board = makeBoard([
      '........',
      '........',
      '........',
      '...WWB..',
      '........',
      '........',
      '........',
      '........',
    ]);

    const flips = getFlipsInDirection(
      board,
      { row: 3, col: 2 },
      { row: 0, col: 1 },
      'black',
    );

    expect(flips).toEqual([
      { row: 3, col: 3 },
      { row: 3, col: 4 },
    ]);
  });

  it('flips vertically downward', () => {
    const board = makeBoard([
      '........',
      '........',
      '...B....',
      '...W....',
      '...W....',
      '...B....',
      '........',
      '........',
    ]);

    const flips = getFlipsInDirection(
      board,
      { row: 2, col: 3 },
      { row: 1, col: 0 },
      'black',
    );

    expect(flips).toEqual([
      { row: 3, col: 3 },
      { row: 4, col: 3 },
    ]);
  });

  it('flips diagonally', () => {
    const board = makeBoard([
      '........',
      '........',
      '...B....',
      '....W...',
      '.....W..',
      '......B.',
      '........',
      '........',
    ]);

    const flips = getFlipsInDirection(
      board,
      { row: 2, col: 3 },
      { row: 1, col: 1 },
      'black',
    );

    expect(flips).toEqual([
      { row: 3, col: 4 },
      { row: 4, col: 5 },
    ]);
  });

  it('returns no flips when bracketed by empty squares', () => {
    const board = makeBoard([
      '........',
      '........',
      '........',
      '...BW...',
      '........',
      '........',
      '........',
      '........',
    ]);

    const flips = getFlipsInDirection(
      board,
      { row: 3, col: 2 },
      { row: 0, col: 1 },
      'black',
    );

    expect(flips).toEqual([]);
  });
});

describe('getAllFlips', () => {
  it('combines flips from multiple directions', () => {
    const board = makeBoard([
      '........',
      '...B....',
      '...W....',
      '.BW.WB..',
      '...W....',
      '...B....',
      '........',
      '........',
    ]);

    const flips = getAllFlips(board, { row: 3, col: 3 }, 'black');

    expect(flips).toEqual(
      expect.arrayContaining([
        { row: 3, col: 2 },
        { row: 3, col: 4 },
        { row: 2, col: 3 },
        { row: 4, col: 3 },
      ]),
    );
    expect(flips).toHaveLength(4);
  });
});

describe('applyMove', () => {
  it('applies a legal opening move and flips the captured disc', () => {
    const state = createInitialGameState();
    const nextState = applyMove(state, { row: 2, col: 3 });

    expect(nextState).not.toBeNull();
    expect(nextState?.board[2][3]).toBe('black');
    expect(nextState?.board[3][3]).toBe('black');
    expect(nextState?.currentPlayer).toBe('white');
    expect(nextState?.consecutivePasses).toBe(0);
  });

  it('rejects illegal moves', () => {
    const state = createInitialGameState();

    expect(applyMove(state, { row: 0, col: 0 })).toBeNull();
    expect(applyMove(state, { row: 3, col: 3 })).toBeNull();
  });

  it('rejects moves after the game has finished', () => {
    const finishedState: GameState = {
      board: createInitialBoard(),
      currentPlayer: 'black',
      status: 'finished',
      legalMoves: [],
      consecutivePasses: 2,
    };

    expect(applyMove(finishedState, { row: 2, col: 3 })).toBeNull();
  });
});

describe('automatic passing', () => {
  const passBoard = makeBoard([
    'WWWWWWWW',
    'WWWWWWWW',
    'WWWWWWWW',
    'BBBBBBBB',
    'BBBBBBBB',
    'BBBBBBBB',
    '........',
    '........',
  ]);

  it('passes to the opponent when the current player has no legal moves', () => {
    expect(getLegalMoves(passBoard, 'black')).toHaveLength(0);
    expect(getLegalMoves(passBoard, 'white').length).toBeGreaterThan(0);

    const state = resolveTurnState(passBoard, 'black', 0);

    expect(state.currentPlayer).toBe('white');
    expect(state.status).toBe('playing');
    expect(state.consecutivePasses).toBe(1);
    expect(state.legalMoves.length).toBeGreaterThan(0);
  });

  it('ends the game after two consecutive passes', () => {
    const fullBoard = makeBoard([
      'BBBBBBBB',
      'BBBBBBBB',
      'BBBBBBBB',
      'BBBBBBBB',
      'WWWWWWWW',
      'WWWWWWWW',
      'WWWWWWWW',
      'WWWWWWWW',
    ]);

    expect(getLegalMoves(fullBoard, 'white')).toHaveLength(0);

    const state = resolveTurnState(fullBoard, 'white', 1);

    expect(state.status).toBe('finished');
    expect(state.consecutivePasses).toBe(2);
    expect(state.legalMoves).toHaveLength(0);
  });

  it('ends immediately when neither player can move', () => {
    const fullBoard = makeBoard([
      'BBBBBBBB',
      'BBBBBBBB',
      'BBBBBBBB',
      'BBBBBBBB',
      'WWWWWWWW',
      'WWWWWWWW',
      'WWWWWWWW',
      'WWWWWWWW',
    ]);

    const state = resolveTurnState(fullBoard, 'black', 0);

    expect(state.status).toBe('finished');
    expect(state.consecutivePasses).toBe(1);
  });
});

describe('getScores', () => {
  it('counts discs on the initial board', () => {
    const scores = getScores(createInitialBoard());

    expect(scores).toEqual({ black: 2, white: 2 });
  });

  it('updates scores after a move', () => {
    const state = createInitialGameState();
    const nextState = applyMove(state, { row: 2, col: 3 });

    expect(nextState).not.toBeNull();
    expect(getScores(nextState!.board)).toEqual({ black: 4, white: 1 });
  });
});

describe('getGameResult', () => {
  it('declares black the winner when ahead', () => {
    expect(getGameResult({ black: 33, white: 31 })).toBe('black');
  });

  it('declares white the winner when ahead', () => {
    expect(getGameResult({ black: 10, white: 54 })).toBe('white');
  });

  it('declares a draw when scores are tied', () => {
    expect(getGameResult({ black: 32, white: 32 })).toBe('draw');
  });
});

describe('game completion', () => {
  it('finishes when neither player can move', () => {
    const board = makeBoard([
      'BBBBBBBB',
      'BBBBBBBB',
      'BBBBBBBB',
      'BBBBBBBB',
      'WWWWWWWW',
      'WWWWWWWW',
      'WWWWWWWW',
      'WWWWWWWW',
    ]);

    expect(getLegalMoves(board, 'black')).toHaveLength(0);
    expect(getLegalMoves(board, 'white')).toHaveLength(0);

    const scores = getScores(board);
    expect(getGameResult(scores)).toBe('draw');
  });
});
