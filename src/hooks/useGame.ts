import { useCallback, useEffect, useRef, useState } from 'react';

import { createInitialGameState, getGameResult, getScores } from '../game';
import type { GameState, Position } from '../game';
import { createGamePoller } from './gamePolling';

interface GameRecord {
  readonly id: string;
  readonly joinCode: string;
  readonly state: GameState;
  readonly version: number;
}

type GameErrorKind = 'not-found' | 'api';

const SELECTED_JOIN_CODE_KEY = 'othello.selectedJoinCode';
const POLL_INTERVAL_MS = 2000;

function normalizeJoinCode(code: string): string {
  return code.trim().toUpperCase();
}

function readStoredJoinCode(): string | null {
  const storedCode = localStorage.getItem(SELECTED_JOIN_CODE_KEY);
  const normalizedCode = storedCode ? normalizeJoinCode(storedCode) : '';

  return normalizedCode || null;
}

function storeJoinCode(joinCode: string): void {
  localStorage.setItem(SELECTED_JOIN_CODE_KEY, normalizeJoinCode(joinCode));
}

async function readGameResponse(response: Response): Promise<GameRecord> {
  if (!response.ok) {
    const error = new Error(`Game request failed with status ${response.status}`);
    if (response.status === 404) {
      error.name = 'NotFoundError';
    }
    throw error;
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

async function getGame(joinCode: string): Promise<GameRecord> {
  return readGameResponse(
    await fetch(`/api/games/${encodeURIComponent(normalizeJoinCode(joinCode))}`),
  );
}

async function submitMove(
  joinCode: string,
  move: Position,
  expectedVersion: number,
): Promise<GameRecord> {
  return readGameResponse(
    await fetch(
      `/api/games/${encodeURIComponent(normalizeJoinCode(joinCode))}/moves`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...move, expectedVersion }),
      },
    ),
  );
}

function getErrorKind(error: unknown): GameErrorKind {
  return error instanceof Error && error.name === 'NotFoundError'
    ? 'not-found'
    : 'api';
}

export function useGame() {
  const [game, setGame] = useState<GameRecord | null>(null);
  const [selectedJoinCode, setSelectedJoinCode] = useState<string | null>(
    readStoredJoinCode,
  );
  const [isLoading, setIsLoading] = useState(() => readStoredJoinCode() !== null);
  const [isSubmittingMove, setIsSubmittingMove] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<GameErrorKind | null>(null);
  const [syncWarningMessage, setSyncWarningMessage] = useState<string | null>(null);
  const initialJoinCodeRef = useRef(selectedJoinCode);
  const currentVersionRef = useRef<number | null>(null);

  const gameState = game?.state ?? createInitialGameState();
  const scores = getScores(gameState.board);
  const result =
    gameState.status === 'finished' ? getGameResult(scores) : null;

  useEffect(() => {
    currentVersionRef.current = game?.version ?? null;
  }, [game?.version]);

  const loadGame = useCallback(async (joinCode: string) => {
    const normalizedCode = normalizeJoinCode(joinCode);
    if (!normalizedCode) {
      setGame(null);
      setSelectedJoinCode(null);
      setErrorMessage('Enter a join code.');
      setErrorKind('api');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setErrorKind(null);

    try {
      const loadedGame = await getGame(normalizedCode);
      setGame(loadedGame);
      setSelectedJoinCode(loadedGame.joinCode);
      setSyncWarningMessage(null);
      storeJoinCode(loadedGame.joinCode);
    } catch (error) {
      const kind = getErrorKind(error);
      setGame(null);
      setSelectedJoinCode(normalizedCode);
      setErrorKind(kind);
      setErrorMessage(
        kind === 'not-found'
          ? 'No game found for that join code.'
          : 'Unable to load the game.',
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let isActive = true;

    async function restoreSelectedGame() {
      const initialJoinCode = initialJoinCodeRef.current;
      if (!initialJoinCode) {
        return;
      }

      try {
        const loadedGame = await getGame(initialJoinCode);
        if (isActive) {
          setGame(loadedGame);
          setSelectedJoinCode(loadedGame.joinCode);
          setSyncWarningMessage(null);
          storeJoinCode(loadedGame.joinCode);
        }
      } catch (error) {
        if (isActive) {
          const kind = getErrorKind(error);
          setGame(null);
          setErrorKind(kind);
          setErrorMessage(
            kind === 'not-found'
              ? 'No game found for that join code.'
              : 'Unable to load the game.',
          );
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void restoreSelectedGame();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!game?.joinCode) {
      return;
    }

    const poller = createGamePoller<GameRecord>({
      intervalMs: POLL_INTERVAL_MS,
      getVisibilityState: () => document.visibilityState,
      addVisibilityListener: (listener) => {
        document.addEventListener('visibilitychange', listener);
      },
      removeVisibilityListener: (listener) => {
        document.removeEventListener('visibilitychange', listener);
      },
      setTimer: (listener, delayMs) => window.setTimeout(listener, delayMs),
      clearTimer: (timerId) => {
        window.clearTimeout(timerId as number);
      },
      fetchGame: () => getGame(game.joinCode),
      getCurrentVersion: () => currentVersionRef.current,
      getGameVersion: (polledGame) => polledGame.version,
      onNewerGame: (polledGame) => {
        setGame(polledGame);
      },
      onRepeatedFailure: () => {
        setSyncWarningMessage('Sync is temporarily delayed.');
      },
      onSuccess: () => {
        setSyncWarningMessage(null);
      },
    });

    poller.start();

    return () => {
      poller.stop();
    };
  }, [game?.joinCode]);

  const playMove = useCallback(
    async (move: Position) => {
      if (
        !game ||
        !selectedJoinCode ||
        game.state.status === 'finished' ||
        isSubmittingMove
      ) {
        return;
      }

      setIsSubmittingMove(true);
      setErrorMessage(null);
      setErrorKind(null);

      try {
        const updatedGame = await submitMove(selectedJoinCode, move, game.version);
        setGame(updatedGame);
        setSyncWarningMessage(null);
      } catch {
        setErrorMessage('Unable to submit that move.');
        setErrorKind('api');
        try {
          setGame(await getGame(selectedJoinCode));
        } catch {
          setGame(null);
        }
      } finally {
        setIsSubmittingMove(false);
      }
    },
    [game, isSubmittingMove, selectedJoinCode],
  );

  const startNewGame = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    setErrorKind(null);

    try {
      const createdGame = await createGame();
      setGame(createdGame);
      setSelectedJoinCode(createdGame.joinCode);
      setSyncWarningMessage(null);
      storeJoinCode(createdGame.joinCode);
    } catch {
      setErrorMessage('Unable to start a new game.');
      setErrorKind('api');
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    gameState,
    joinCode: game?.joinCode ?? selectedJoinCode,
    version: game?.version ?? null,
    scores,
    result,
    playMove,
    startNewGame,
    loadGame,
    hasSelectedGame: game !== null,
    isLoading,
    isSubmittingMove,
    errorMessage,
    errorKind,
    syncWarningMessage,
  };
}
