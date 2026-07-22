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
  readonly joinCode: string;
  readonly state: GameState;
  readonly version: number;
  readonly playerColor?: Player;
  readonly opponentJoined: boolean;
  readonly playerToken?: string;
  readonly invitation?: string;
}

interface MoveRequest {
  readonly row: number;
  readonly col: number;
  readonly expectedVersion: number;
}

interface JoinRequest {
  readonly inviteToken: string;
}

interface GameRow {
  readonly id: string;
  readonly join_code: string;
  readonly board_json: string;
  readonly current_player: string;
  readonly status: string;
  readonly winner: string | null;
  readonly black_score: number;
  readonly white_score: number;
  readonly consecutive_passes: number;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly black_player_token_digest: string;
  readonly white_player_token_digest: string | null;
  readonly white_invite_token_digest: string;
  readonly white_joined: number;
  readonly black_player_created_at: string;
  readonly white_invite_created_at: string;
  readonly white_invite_claimed_at: string | null;
  readonly white_player_created_at: string | null;
}

interface StoredGame {
  readonly id: string;
  readonly joinCode: string;
  readonly state: GameState;
  readonly version: number;
  readonly winner: GameResult | null;
  readonly blackScore: number;
  readonly whiteScore: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly blackPlayerTokenDigest: string;
  readonly whitePlayerTokenDigest: string | null;
  readonly whiteInviteTokenDigest: string;
  readonly whiteJoined: boolean;
}

interface WorkerEnv extends Env {
  readonly DB: D1Database;
}

const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const JOIN_CODE_LENGTH = 6;
const MAX_JOIN_CODE_ATTEMPTS = 8;
const TOKEN_BYTE_LENGTH = 32;

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

function errorResponse(status: number, message: string): Response {
  return jsonResponse({ error: message }, { status });
}

function toGameRecord(
  game: StoredGame,
  playerColor?: Player,
  extras?: Pick<GameRecord, 'playerToken' | 'invitation'>,
): GameRecord {
  return {
    id: game.id,
    joinCode: game.joinCode,
    state: game.state,
    version: game.version,
    playerColor,
    opponentJoined: playerColor === 'white' ? true : game.whiteJoined,
    ...extras,
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

function normalizeJoinCode(code: string): string {
  return code.trim().toUpperCase();
}

function isValidJoinCode(code: string): boolean {
  return (
    code.length === JOIN_CODE_LENGTH &&
    [...code].every((character) => JOIN_CODE_ALPHABET.includes(character))
  );
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function generateToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTE_LENGTH);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function digestToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}

function generateJoinCode(): string {
  const values = new Uint32Array(JOIN_CODE_LENGTH);
  crypto.getRandomValues(values);

  return [...values]
    .map((value) => JOIN_CODE_ALPHABET[value % JOIN_CODE_ALPHABET.length])
    .join('');
}

function parseBearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization');
  const match = header?.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();

  return token || null;
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
    typeof row.id !== 'string' ||
    typeof row.join_code !== 'string' ||
    !isValidJoinCode(row.join_code) ||
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
    typeof row.updated_at !== 'string' ||
    typeof row.black_player_token_digest !== 'string' ||
    (row.white_invite_token_digest !== null &&
      typeof row.white_invite_token_digest !== 'string') ||
    (row.white_player_token_digest !== null &&
      typeof row.white_player_token_digest !== 'string') ||
    row.white_joined !== 0 && row.white_joined !== 1
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
    joinCode: row.join_code,
    state,
    version: row.version,
    winner,
    blackScore: scores.black,
    whiteScore: scores.white,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    blackPlayerTokenDigest: row.black_player_token_digest,
    whitePlayerTokenDigest: row.white_player_token_digest,
    whiteInviteTokenDigest: row.white_invite_token_digest ?? '',
    whiteJoined: row.white_joined === 1,
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
  const expectedVersion = body.expectedVersion;

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

async function parseJoinRequest(request: Request): Promise<JoinRequest | null> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return null;
  }

  if (!isPlainObject(body) || typeof body.inviteToken !== 'string' || !body.inviteToken) {
    return null;
  }

  return { inviteToken: body.inviteToken };
}

async function getGameByJoinCode(
  db: D1Database,
  joinCode: string,
): Promise<StoredGame | null> {
  const normalizedCode = normalizeJoinCode(joinCode);

  if (!isValidJoinCode(normalizedCode)) {
    return null;
  }

  const row = await db
    .prepare(
      `SELECT id, join_code, board_json, current_player, status, winner,
              black_score, white_score, consecutive_passes, version,
              created_at, updated_at, black_player_token_digest,
              white_player_token_digest, white_invite_token_digest,
              white_joined, black_player_created_at, white_invite_created_at,
              white_invite_claimed_at, white_player_created_at
       FROM games
       WHERE join_code = ?`,
    )
    .bind(normalizedCode)
    .first<GameRow>();

  if (!row) {
    return null;
  }

  return rowToStoredGame(row);
}

async function authenticateGame(
  request: Request,
  db: D1Database,
  joinCode: string,
): Promise<{ readonly game: StoredGame; readonly playerColor: Player } | Response> {
  const game = await getGameByJoinCode(db, joinCode);
  if (!game) {
    return errorResponse(404, 'Game not found');
  }

  const token = parseBearerToken(request);
  if (!token) {
    return errorResponse(401, 'Missing player token');
  }

  const tokenDigest = await digestToken(token);
  if (tokenDigest === game.blackPlayerTokenDigest) {
    return { game, playerColor: 'black' };
  }
  if (game.whitePlayerTokenDigest && tokenDigest === game.whitePlayerTokenDigest) {
    return { game, playerColor: 'white' };
  }

  return errorResponse(401, 'Invalid player token');
}

async function insertGame(
  db: D1Database,
  id: string,
  joinCode: string,
  state: GameState,
  blackTokenDigest: string,
  whiteInviteTokenDigest: string,
): Promise<boolean> {
  const fields = gameStateToStorageFields(state);
  const now = new Date().toISOString();
  const version = 1;

  try {
    await db
      .prepare(
        `INSERT INTO games (
          id, join_code, board_json, current_player, status, winner,
          black_score, white_score, consecutive_passes, version,
          created_at, updated_at, black_player_token_digest,
          white_player_token_digest, white_invite_token_digest, white_joined,
          black_player_created_at, white_invite_created_at,
          white_invite_claimed_at, white_player_created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        joinCode,
        fields.boardJson,
        fields.currentPlayer,
        fields.status,
        fields.winner,
        fields.blackScore,
        fields.whiteScore,
        fields.consecutivePasses,
        version,
        now,
        now,
        blackTokenDigest,
        null,
        whiteInviteTokenDigest,
        0,
        now,
        now,
        null,
        null,
      )
      .run();
  } catch {
    return false;
  }

  return true;
}

async function createGame(db: D1Database): Promise<GameRecord | null> {
  const state = createInitialGameState();
  const blackToken = generateToken();
  const whiteInviteToken = generateToken();
  const blackTokenDigest = await digestToken(blackToken);
  const whiteInviteTokenDigest = await digestToken(whiteInviteToken);

  for (let attempt = 0; attempt < MAX_JOIN_CODE_ATTEMPTS; attempt += 1) {
    const id = crypto.randomUUID();
    const joinCode = generateJoinCode();
    const didInsert = await insertGame(
      db,
      id,
      joinCode,
      state,
      blackTokenDigest,
      whiteInviteTokenDigest,
    );

    if (didInsert) {
      const game = await getGameByJoinCode(db, joinCode);
      return game
        ? toGameRecord(game, 'black', {
            playerToken: blackToken,
            invitation: `${joinCode}:${whiteInviteToken}`,
          })
        : null;
    }
  }

  return null;
}

async function claimWhite(
  db: D1Database,
  game: StoredGame,
  inviteTokenDigest: string,
  whiteTokenDigest: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE games
       SET white_player_token_digest = ?,
           white_joined = 1,
           white_invite_token_digest = NULL,
           version = ?,
           white_invite_claimed_at = ?,
           white_player_created_at = ?,
           updated_at = ?
       WHERE id = ? AND join_code = ? AND white_joined = 0
         AND white_invite_token_digest = ?`,
    )
    .bind(
      whiteTokenDigest,
      game.version + 1,
      now,
      now,
      now,
      game.id,
      game.joinCode,
      inviteTokenDigest,
    )
    .run();

  return (result.meta.changes ?? 0) > 0;
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
      `UPDATE games
       SET board_json = ?,
           current_player = ?,
           status = ?,
           winner = ?,
           black_score = ?,
           white_score = ?,
           consecutive_passes = ?,
           version = ?,
           updated_at = ?
       WHERE id = ? AND join_code = ? AND version = ?`,
    )
    .bind(
      fields.boardJson,
      fields.currentPlayer,
      fields.status,
      fields.winner,
      fields.blackScore,
      fields.whiteScore,
      fields.consecutivePasses,
      nextVersion,
      updatedAt,
      game.id,
      game.joinCode,
      game.version,
    )
    .run();

  return (result.meta.changes ?? 0) > 0;
}

async function handleJoin(
  request: Request,
  db: D1Database,
  joinCode: string,
): Promise<Response> {
  const joinRequest = await parseJoinRequest(request);
  if (!joinRequest) {
    return errorResponse(400, 'Malformed join request');
  }

  const game = await getGameByJoinCode(db, joinCode);
  if (!game) {
    return errorResponse(404, 'Game not found');
  }

  if (game.whiteJoined) {
    return errorResponse(409, 'White already joined');
  }

  const inviteDigest = await digestToken(joinRequest.inviteToken);
  if (inviteDigest !== game.whiteInviteTokenDigest) {
    return errorResponse(403, 'Invalid invitation token');
  }

  const whiteToken = generateToken();
  const whiteTokenDigest = await digestToken(whiteToken);
  const didClaim = await claimWhite(db, game, inviteDigest, whiteTokenDigest);
  if (!didClaim) {
    return errorResponse(409, 'White already joined');
  }

  const updatedGame = await getGameByJoinCode(db, game.joinCode);
  if (!updatedGame) {
    return errorResponse(404, 'Game not found');
  }

  return jsonResponse(
    toGameRecord(updatedGame, 'white', { playerToken: whiteToken }),
  );
}

async function handleMove(
  request: Request,
  db: D1Database,
  joinCode: string,
): Promise<Response> {
  const moveRequest = await parseMoveRequest(request);
  if (!moveRequest) {
    return errorResponse(400, 'Malformed move request');
  }

  const authResult = await authenticateGame(request, db, joinCode);
  if (authResult instanceof Response) {
    return authResult;
  }

  const { game, playerColor } = authResult;
  if (!game.whiteJoined) {
    return errorResponse(403, 'Waiting for opponent to join');
  }
  if (playerColor !== game.state.currentPlayer) {
    return errorResponse(403, 'Not your turn');
  }
  if (moveRequest.expectedVersion !== game.version) {
    return errorResponse(409, 'Stale game version');
  }

  const move: Position = { row: moveRequest.row, col: moveRequest.col };
  const nextState = applyMove(game.state, move);

  if (!nextState) {
    return errorResponse(422, 'Illegal move');
  }

  const didPersist = await persistMove(db, game, nextState);
  if (!didPersist) {
    return errorResponse(409, 'Stale game version');
  }

  const persistedGame = await getGameByJoinCode(db, game.joinCode);
  if (!persistedGame) {
    return errorResponse(404, 'Game not found');
  }

  return jsonResponse(toGameRecord(persistedGame, playerColor));
}

function parseGamePath(pathname: string):
  | { readonly code: string; readonly action: 'read' | 'move' | 'join' }
  | null {
  const match = /^\/api\/games\/([^/]+)(?:\/(moves|join))?$/.exec(pathname);
  if (!match) {
    return null;
  }

  const suffix = match[2];
  return {
    code: decodeURIComponent(match[1]),
    action: suffix === 'moves' ? 'move' : suffix === 'join' ? 'join' : 'read',
  };
}

async function routeApiRequest(
  request: Request,
  env: WorkerEnv,
  url: URL,
): Promise<Response> {
  if (url.pathname === '/api/games' && request.method === 'POST') {
    const game = await createGame(env.DB);
    if (!game) {
      return errorResponse(500, 'Unable to create game');
    }

    return jsonResponse(game, { status: 201 });
  }

  const gamePath = parseGamePath(url.pathname);
  if (gamePath?.action === 'join' && request.method === 'POST') {
    return handleJoin(request, env.DB, gamePath.code);
  }

  if (gamePath?.action === 'read' && request.method === 'GET') {
    const authResult = await authenticateGame(request, env.DB, gamePath.code);
    if (authResult instanceof Response) {
      return authResult;
    }

    return jsonResponse(toGameRecord(authResult.game, authResult.playerColor));
  }

  if (gamePath?.action === 'move' && request.method === 'POST') {
    return handleMove(request, env.DB, gamePath.code);
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
