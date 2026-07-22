import { describe, expect, it } from 'vitest';

import { createInitialBoard } from '../game';
import {
  getChangedPositions,
  getLastPresentedMoveKey,
  getRelativeStatusMessage,
  readLastPresentedMoveVersion,
  reconstructBoardBeforeLastMove,
  shouldAnimateLastMove,
  writeLastPresentedMoveVersion,
} from './gamePresentation';

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

describe('last move animation helpers', () => {
  it('reconstructs the board before the latest move', () => {
    const finalBoard = createInitialBoard().map((row) => [...row]);
    finalBoard[2][3] = 'black';
    finalBoard[3][3] = 'black';

    const reconstructed = reconstructBoardBeforeLastMove(finalBoard, {
      version: 2,
      player: 'black',
      placedIndex: 19,
      flippedIndices: [27],
    });

    expect(reconstructed?.[2][3]).toBeNull();
    expect(reconstructed?.[3][3]).toBe('white');
    expect(reconstructed?.[3][4]).toBe('black');
    expect(reconstructed?.[4][4]).toBe('white');
  });

  it('only treats unpresented matching metadata as animation eligible', () => {
    expect(
      shouldAnimateLastMove({
        joinCode: 'ABCDEF',
        currentVersion: 2,
        lastPresentedVersion: 1,
        lastMove: {
          version: 2,
          player: 'black',
          placedIndex: 19,
          flippedIndices: [27],
        },
      }),
    ).toBe(true);

    expect(
      shouldAnimateLastMove({
        joinCode: 'ABCDEF',
        currentVersion: 2,
        lastPresentedVersion: 2,
        lastMove: {
          version: 2,
          player: 'black',
          placedIndex: 19,
          flippedIndices: [27],
        },
      }),
    ).toBe(false);

    expect(
      shouldAnimateLastMove({
        joinCode: 'ABCDEF',
        currentVersion: 3,
        lastPresentedVersion: 1,
        lastMove: {
          version: 2,
          player: 'black',
          placedIndex: 19,
          flippedIndices: [27],
        },
      }),
    ).toBe(false);
  });

  it('stores acknowledged animation versions per game', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };

    writeLastPresentedMoveVersion(storage, 'abcdef', 4);

    expect(values.get(getLastPresentedMoveKey('ABCDEF'))).toBe('4');
    expect(readLastPresentedMoveVersion(storage, 'ABCDEF')).toBe(4);
    expect(readLastPresentedMoveVersion(storage, 'ZZZZZZ')).toBeNull();
  });
});
