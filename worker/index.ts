import {
  applyMove,
  BOARD_SIZE,
  createInitialGameState,
  getGameResult,
  getScores,
  resolveTurnState,
} from '../src/game';
import type { Board, Cell, GameResult, GameState, Player, Position } from '../src/game';

interface GameRecord {
  readonly id: string;
  readonly state: GameState;
  readonly version: number;
}

interface MoveRequest {
  readonly row: number;
  readonly col: number;
  readonly expectedVersion: number;
}

interface GameRow {
  readonly singleton_key: string;
  readonly id: string;
  readonly board_json: string;
  readonly current_player: string;
  readonly status: string;
  readonly winner: string | null;
  readonly black_score: number;
  readonly white_score: number;
  readonly version: number;
  readonly consecutive_passes: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface StoredGame {
  readonly id: string;
  readonly state: GameState;
  readonly version: number;
  readonly winner: GameResult | null;
  readonly blackScore: number;
  readonly whiteScore: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface WorkerEnv extends Env {
  readonly DB: D1Database;
}

const CURRENT_GAME_KEY = 'current';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

function errorResponse(status: number, message: string): Response {
  return jsonResponse({ error: message }, { status });
}

function toGameRecord(game: StoredGame): GameRecord {
  return {
    id: game.id,
    state: game.state,
    version: game.version,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlayer(value: unknown): value is Player {
  return value === 'black' || value === 'white';
}

function isGameStatus(value: unknown): value is GameState['status'] {
  return value === 'playing' || value === 'finished';
}

function isGameResult(value: unknown): value is GameResult {
  return value === 'black' || value === 'white' || value === 'draw';
}

function parseBoard(value: string): Board | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed) || parsed.length !== BOARD_SIZE) {
    return null;
  }

  const board: Cell[][] = [];

  for (const row of parsed) {
    if (!Array.isArray(row) || row.length !== BOARD_SIZE) {
      return null;
    }

    const cells: Cell[] = [];

    for (const cell of row) {
      if (cell !== null && !isPlayer(cell)) {
        return null;
      }
      cells.push(cell);
    }

    board.push(cells);
  }

  return board;
}

function rowToStoredGame(row: GameRow): StoredGame | null {
  if (
    row.singleton_key !== CURRENT_GAME_KEY ||
    typeof row.id !== 'string' ||
    !isPlayer(row.current_player) ||
    !isGameStatus(row.status) ||
    typeof row.version !== 'number' ||
    !Number.isInteger(row.version) ||
    row.version < 1 ||
    typeof row.consecutive_passes !== 'number' ||
    !Number.isInteger(row.consecutive_passes) ||
    row.consecutive_passes < 0 ||
    typeof row.black_score !== 'number' ||
    typeof row.white_score !== 'number' ||
    !Number.isInteger(row.black_score) ||
    !Number.isInteger(row.white_score) ||
    typeof row.created_at !== 'string' ||
    typeof row.updated_at !== 'string'
  ) {
    return null;
  }

  const board = parseBoard(row.board_json);
  if (!board) {
    return null;
  }

  const state = resolveTurnState(board, row.current_player, row.consecutive_passes);
  if (state.status !== row.status) {
    return null;
  }

  const scores = getScores(state.board);
  if (scores.black !== row.black_score || scores.white !== row.white_score) {
    return null;
  }

  const winner = row.winner;
  if (winner !== null && !isGameResult(winner)) {
    return null;
  }

  const expectedWinner =
    state.status === 'finished' ? getGameResult(scores) : null;
  if (winner !== expectedWinner) {
    return null;
  }

  return {
    id: row.id,
    state,
    version: row.version,
    winner,
    blackScore: scores.black,
    whiteScore: scores.white,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function gameStateToStorageFields(state: GameState) {
  const scores = getScores(state.board);
  const winner = state.status === 'finished' ? getGameResult(scores) : null;

  return {
    boardJson: JSON.stringify(state.board),
    currentPlayer: state.currentPlayer,
    status: state.status,
    winner,
    blackScore: scores.black,
    whiteScore: scores.white,
    consecutivePasses: state.consecutivePasses,
  };
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
  const expectedVersion = body.expectedVersion ?? body.version;

  if (
    typeof row !== 'number' ||
    typeof col !== 'number' ||
    typeof expectedVersion !== 'number' ||
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    !Number.isInteger(expectedVersion)
  ) {
    return null;
  }

  return { row, col, expectedVersion };
}

async function getCurrentGame(db: D1Database): Promise<StoredGame | null> {
  const row = await db
    .prepare(
      `SELECT singleton_key, id, board_json, current_player, status, winner,
              black_score, white_score, version, consecutive_passes,
              created_at, updated_at
       FROM current_game
       WHERE singleton_key = ?`,
    )
    .bind(CURRENT_GAME_KEY)
    .first<GameRow>();

  if (!row) {
    return null;
  }

  return rowToStoredGame(row);
}

async function createGame(db: D1Database): Promise<StoredGame> {
  const state = createInitialGameState();
  const fields = gameStateToStorageFields(state);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const version = 1;

  await db
    .prepare(
      `INSERT OR REPLACE INTO current_game (
        singleton_key, id, board_json, current_player, status, winner,
        black_score, white_score, version, consecutive_passes,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      CURRENT_GAME_KEY,
      id,
      fields.boardJson,
      fields.currentPlayer,
      fields.status,
      fields.winner,
      fields.blackScore,
      fields.whiteScore,
      version,
      fields.consecutivePasses,
      now,
      now,
    )
    .run();

  return {
    id,
    state,
    version,
    winner: fields.winner,
    blackScore: fields.blackScore,
    whiteScore: fields.whiteScore,
    createdAt: now,
    updatedAt: now,
  };
}

async function persistMove(
  db: D1Database,
  game: StoredGame,
  nextState: GameState,
): Promise<boolean> {
  const fields = gameStateToStorageFields(nextState);
  const updatedAt = new Date().toISOString();
  const nextVersion = game.version + 1;

  const result = await db
    .prepare(
      `UPDATE current_game
       SET board_json = ?,
           current_player = ?,
           status = ?,
           winner = ?,
           black_score = ?,
           white_score = ?,
           version = ?,
           consecutive_passes = ?,
           updated_at = ?
       WHERE singleton_key = ? AND version = ?`,
    )
    .bind(
      fields.boardJson,
      fields.currentPlayer,
      fields.status,
      fields.winner,
      fields.blackScore,
      fields.whiteScore,
      nextVersion,
      fields.consecutivePasses,
      updatedAt,
      CURRENT_GAME_KEY,
      game.version,
    )
    .run();

  return (result.meta.changes ?? 0) > 0;
}

async function handleMove(request: Request, db: D1Database): Promise<Response> {
  const currentGame = await getCurrentGame(db);

  const moveRequest = await parseMoveRequest(request);
  if (!moveRequest) {
    return errorResponse(400, 'Malformed move request');
  }

  if (!currentGame) {
    return errorResponse(404, 'No current game');
  }

  if (moveRequest.expectedVersion !== currentGame.version) {
    return errorResponse(409, 'Stale game version');
  }

  const move: Position = { row: moveRequest.row, col: moveRequest.col };
  const nextState = applyMove(currentGame.state, move);

  if (!nextState) {
    return errorResponse(422, 'Illegal move');
  }

  const didPersist = await persistMove(db, currentGame, nextState);
  if (!didPersist) {
    return errorResponse(409, 'Stale game version');
  }

  const persistedGame = await getCurrentGame(db);
  if (!persistedGame) {
    return errorResponse(404, 'No current game');
  }

  return jsonResponse(toGameRecord(persistedGame));
}

async function routeApiRequest(
  request: Request,
  env: WorkerEnv,
  url: URL,
): Promise<Response> {
  if (url.pathname === '/api/games' && request.method === 'POST') {
    return jsonResponse(toGameRecord(await createGame(env.DB)), { status: 201 });
  }

  if (url.pathname === '/api/games/current' && request.method === 'GET') {
    const currentGame = await getCurrentGame(env.DB);
    if (!currentGame) {
      return errorResponse(404, 'No current game');
    }

    return jsonResponse(toGameRecord(currentGame));
  }

  if (url.pathname === '/api/games/current/moves' && request.method === 'POST') {
    return handleMove(request, env.DB);
  }

  return errorResponse(404, 'Not found');
}

export default {
  fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return routeApiRequest(request, env, url);
    }

    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<WorkerEnv>;
