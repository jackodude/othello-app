import { useCallback, useEffect, useState } from 'react';

import { createInitialGameState, getGameResult, getScores } from '../game';
import type { GameState, Position } from '../game';

interface GameRecord {
  readonly id: string;
  readonly state: GameState;
  readonly version: number;
}

async function readGameResponse(response: Response): Promise<GameRecord> {
  if (!response.ok) {
    throw new Error(`Game request failed with status ${response.status}`);
  }

  return response.json() as Promise<GameRecord>;
}

async function createGame(): Promise<GameRecord> {
  return readGameResponse(
    await fetch('/api/games', {
      method: 'POST',
    }),
  );
}

async function getCurrentGame(): Promise<GameRecord | null> {
  const response = await fetch('/api/games/current');

  if (response.status === 404) {
    return null;
  }

  return readGameResponse(response);
}

async function submitMove(move: Position, version: number): Promise<GameRecord> {
  return readGameResponse(
    await fetch('/api/games/current/moves', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...move, version }),
    }),
  );
}

export function useGame() {
  const [game, setGame] = useState<GameRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmittingMove, setIsSubmittingMove] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const gameState = game?.state ?? createInitialGameState();
  const scores = getScores(gameState.board);
  const result =
    gameState.status === 'finished' ? getGameResult(scores) : null;

  useEffect(() => {
    let isActive = true;

    async function loadInitialGame() {
      try {
        const currentGame = await getCurrentGame();
        const loadedGame = currentGame ?? (await createGame());

        if (isActive) {
          setGame(loadedGame);
        }
      } catch {
        if (isActive) {
          setErrorMessage('Unable to load the game.');
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void loadInitialGame();

    return () => {
      isActive = false;
    };
  }, []);

  const playMove = useCallback(
    async (move: Position) => {
      if (!game || game.state.status === 'finished' || isSubmittingMove) {
        return;
      }

      setIsSubmittingMove(true);
      setErrorMessage(null);

      try {
        setGame(await submitMove(move, game.version));
      } catch {
        setErrorMessage('Unable to submit that move.');
        const currentGame = await getCurrentGame();
        if (currentGame) {
          setGame(currentGame);
        }
      } finally {
        setIsSubmittingMove(false);
      }
    },
    [game, isSubmittingMove],
  );

  const startNewGame = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      setGame(await createGame());
    } catch {
      setErrorMessage('Unable to start a new game.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    gameState,
    version: game?.version ?? null,
    scores,
    result,
    playMove,
    startNewGame,
    isLoading,
    isSubmittingMove,
    errorMessage,
  };
}
