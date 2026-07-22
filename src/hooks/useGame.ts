import { useCallback, useState } from 'react';

import {
  applyMove,
  createInitialGameState,
  getGameResult,
  getScores,
  isLegalMovePosition,
} from '../game';
import type { GameState, Position } from '../game';

export function useGame() {
  const [gameState, setGameState] = useState<GameState>(createInitialGameState);

  const scores = getScores(gameState.board);
  const result =
    gameState.status === 'finished' ? getGameResult(scores) : null;

  const playMove = useCallback((move: Position) => {
    setGameState((currentState) => {
      if (currentState.status === 'finished') {
        return currentState;
      }

      if (!isLegalMovePosition(currentState.legalMoves, move)) {
        return currentState;
      }

      const nextState = applyMove(currentState, move);
      return nextState ?? currentState;
    });
  }, []);

  const startNewGame = useCallback(() => {
    setGameState(createInitialGameState());
  }, []);

  return {
    gameState,
    scores,
    result,
    playMove,
    startNewGame,
  };
}
