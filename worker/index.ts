import { applyMove, createInitialGameState } from '../src/game';
import type { GameState, Position } from '../src/game';

interface GameRecord {
  readonly id: string;
  readonly state: GameState;
  readonly version: number;
}

interface MoveRequest {
  readonly row: number;
  readonly col: number;
  readonly version: number;
}

let currentGame: GameRecord | null = null;
let nextGameId = 1;

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

function errorResponse(status: number, message: string): Response {
  return jsonResponse({ error: message }, { status });
}

function createGame(): GameRecord {
  const game: GameRecord = {
    id: String(nextGameId),
    state: createInitialGameState(),
    version: 1,
  };
  nextGameId += 1;
  currentGame = game;
  return game;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function parseMoveRequest(request: Request): Promise<MoveRequest | null> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return null;
  }

  if (!isPlainObject(body)) {
    return null;
  }

  const row = body.row;
  const col = body.col;
  const version = body.version;

  if (
    typeof row !== 'number' ||
    typeof col !== 'number' ||
    typeof version !== 'number' ||
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    !Number.isInteger(version)
  ) {
    return null;
  }

  return { row, col, version };
}

async function handleMove(request: Request): Promise<Response> {
  if (!currentGame) {
    return errorResponse(404, 'No current game');
  }

  const moveRequest = await parseMoveRequest(request);
  if (!moveRequest) {
    return errorResponse(400, 'Malformed move request');
  }

  if (moveRequest.version !== currentGame.version) {
    return errorResponse(409, 'Stale game version');
  }

  const move: Position = { row: moveRequest.row, col: moveRequest.col };
  const nextState = applyMove(currentGame.state, move);

  if (!nextState) {
    return errorResponse(422, 'Illegal move');
  }

  currentGame = {
    ...currentGame,
    state: nextState,
    version: currentGame.version + 1,
  };

  return jsonResponse(currentGame);
}

function routeApiRequest(request: Request, url: URL): Promise<Response> | Response {
  if (url.pathname === '/api/games' && request.method === 'POST') {
    return jsonResponse(createGame(), { status: 201 });
  }

  if (url.pathname === '/api/games/current' && request.method === 'GET') {
    if (!currentGame) {
      return errorResponse(404, 'No current game');
    }

    return jsonResponse(currentGame);
  }

  if (url.pathname === '/api/games/current/moves' && request.method === 'POST') {
    return handleMove(request);
  }

  return errorResponse(404, 'Not found');
}

export function resetCurrentGameForTests(): void {
  currentGame = null;
  nextGameId = 1;
}

export default {
  fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return routeApiRequest(request, url);
    }

    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
