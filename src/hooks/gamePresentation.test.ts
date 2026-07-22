import { describe, expect, it } from 'vitest';

import { createInitialBoard } from '../game';
import { getChangedPositions, getRelativeStatusMessage } from './gamePresentation';

describe('getRelativeStatusMessage', () => {
  it('uses relative active-game wording', () => {
    expect(
      getRelativeStatusMessage({
        gameStatus: 'playing',
        result: null,
        playerColor: 'black',
        opponentJoined: true,
        isYourTurn: true,
      }),
    ).toBe('Your turn');

    expect(
      getRelativeStatusMessage({
        gameStatus: 'playing',
        result: null,
        playerColor: 'white',
        opponentJoined: true,
        isYourTurn: false,
      }),
    ).toBe("Opponent's turn");
  });

  it('shows waiting and completed outcomes', () => {
    expect(
      getRelativeStatusMessage({
        gameStatus: 'playing',
        result: null,
        playerColor: 'black',
        opponentJoined: false,
        isYourTurn: true,
      }),
    ).toBe('Waiting for opponent');

    expect(
      getRelativeStatusMessage({
        gameStatus: 'finished',
        result: 'black',
        playerColor: 'black',
        opponentJoined: true,
        isYourTurn: false,
      }),
    ).toBe('You win');

    expect(
      getRelativeStatusMessage({
        gameStatus: 'finished',
        result: 'draw',
        playerColor: 'white',
        opponentJoined: true,
        isYourTurn: false,
      }),
    ).toBe('Draw');
  });
});

describe('getChangedPositions', () => {
  it('finds changed board cells', () => {
    const previous = createInitialBoard();
    const next = previous.map((row) => [...row]);
    next[2][3] = 'black';
    next[3][3] = 'black';

    expect(getChangedPositions(previous, next)).toEqual([
      { row: 2, col: 3 },
      { row: 3, col: 3 },
    ]);
  });
});
