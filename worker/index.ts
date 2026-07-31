import {
  buildPushHTTPRequest,
  type PushSubscription as WebPushSubscription,
} from '@pushforge/builder';

import {
  applyMove,
  BOARD_SIZE,
  createInitialGameState,
  getAllFlips,
  getGameResult,
  getOpponent,
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
  readonly lastMove: LastMove | null;
  readonly playerToken?: string;
  readonly invitation?: string;
  readonly players: {
    readonly black: { readonly name: string | null };
    readonly white: { readonly name: string | null };
  };
  readonly playerName?: string | null;
  readonly opponentName?: string | null;
  readonly winner: GameResult | null;
  readonly endedReason: EndedReason;
  readonly forfeitedBy: Player | null;
  readonly rematch: RematchRecord | null;
}

interface RematchRecord {
  readonly joinCode: string;
  readonly requestedBy: Player;
  readonly requestedAt: string | null;
  readonly waiting: boolean;
  readonly accepted: boolean;
}

interface SavedGameRecord {
  readonly id: string;
  readonly joinCode: string;
  readonly state: GameState;
  readonly version: number;
  readonly playerColor: Player;
  readonly opponentJoined: boolean;
  readonly playerName: string | null;
  readonly opponentName: string | null;
  readonly updatedAt: string;
  readonly progress: number;
  readonly winner: GameResult | null;
  readonly endedReason: EndedReason;
  readonly forfeitedBy: Player | null;
  readonly rematch: RematchRecord | null;
}

interface LastMove {
  readonly version: number;
  readonly player: Player;
  readonly placedIndex: number;
  readonly flippedIndices: readonly number[];
}

interface MoveRequest {
  readonly row: number;
  readonly col: number;
  readonly expectedVersion: number;
}

interface JoinRequest {
  readonly inviteToken: string;
  readonly displayName?: string;
}

interface CreateGameRequest {
  readonly displayName?: string;
}

interface PlayerProfileRequest {
  readonly displayName: string;
}

interface SavedGamesRequest {
  readonly credentials: readonly {
    readonly joinCode: string;
    readonly playerToken: string;
  }[];
}

interface PushSubscriptionRequest {
  readonly endpoint: string;
  readonly keys: {
    readonly p256dh: string;
    readonly auth: string;
  };
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
  readonly rematch_of_game_id: string | null;
  readonly black_joined: number;
  readonly black_invite_token_digest: string | null;
  readonly black_invite_created_at: string | null;
  readonly black_invite_claimed_at: string | null;
  readonly last_move_version?: number | null;
  readonly last_move_player?: string | null;
  readonly last_move_placed_index?: number | null;
  readonly last_move_flipped_indices_json?: string | null;
  readonly black_player_name?: string | null;
  readonly white_player_name?: string | null;
  readonly ended_reason?: string | null;
  readonly forfeited_by?: string | null;
  readonly rematch_game_id?: string | null;
  readonly rematch_requested_by?: string | null;
  readonly rematch_requested_at?: string | null;
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
  readonly rematchOfGameId: string | null;
  readonly blackJoined: boolean;
  readonly blackInviteTokenDigest: string;
  readonly lastMove: LastMove | null;
  readonly blackPlayerName: string | null;
  readonly whitePlayerName: string | null;
  readonly endedReason: EndedReason;
  readonly forfeitedBy: Player | null;
  readonly rematchGameId: string | null;
  readonly rematchRequestedBy: Player | null;
  readonly rematchRequestedAt: string | null;
  readonly rematchGame?: StoredGame | null;
}

interface WorkerEnv extends Env {
  readonly DB: D1Database;
  readonly ENABLE_TEST_CONTROLS?: string;
  readonly VAPID_PUBLIC_KEY?: string;
  readonly VAPID_PRIVATE_KEY?: string;
  readonly VAPID_SUBJECT?: string;
}

const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const JOIN_CODE_LENGTH = 6;
const MAX_JOIN_CODE_ATTEMPTS = 8;
const TOKEN_BYTE_LENGTH = 32;
const MAX_NOTIFICATION_ATTEMPTS = 2;
const MAX_DISPLAY_NAME_LENGTH = 24;

type EndedReason = 'normal' | 'forfeit' | 'cancelled';
type NotificationEventType =
  | 'white_joined'
  | 'your_turn'
  | 'game_finished'
  | 'rematch_requested';

interface NotificationEvent {
  readonly eventType: NotificationEventType;
  readonly recipientPlayerColor: Player;
  readonly title: string;
  readonly body: string;
}

interface PushSubscriptionRow {
  readonly id: string;
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

interface PushNotificationEventRow {
  readonly id: string;
  readonly delivery_state: 'pending' | 'sent' | 'failed';
  readonly attempts: number;
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

function errorResponse(status: number, message: string): Response {
  return jsonResponse({ error: message }, { status });
}

function isPushConfigured(env: WorkerEnv): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}

function isTestControlsEnabled(env: WorkerEnv): boolean {
  return env.ENABLE_TEST_CONTROLS === 'true';
}

function toGameRecord(
  game: StoredGame,
  playerColor?: Player,
  extras?: Pick<GameRecord, 'playerToken' | 'invitation'>,
): GameRecord {
  const playerName =
    playerColor === 'black'
      ? game.blackPlayerName
      : playerColor === 'white'
        ? game.whitePlayerName
        : null;
  const opponentName =
    playerColor === 'black'
      ? game.whitePlayerName
      : playerColor === 'white'
        ? game.blackPlayerName
        : null;

  return {
    id: game.id,
    joinCode: game.joinCode,
    state: game.state,
    version: game.version,
    playerColor,
    opponentJoined:
      playerColor === 'white'
        ? game.blackJoined
        : playerColor === 'black'
          ? game.whiteJoined
          : game.blackJoined && game.whiteJoined,
    lastMove: game.lastMove,
    players: {
      black: { name: game.blackPlayerName },
      white: { name: game.whitePlayerName },
    },
    playerName,
    opponentName,
    winner: game.winner,
    endedReason: game.endedReason,
    forfeitedBy: game.forfeitedBy,
    rematch: buildRematchRecord(game),
    ...extras,
  };
}

function buildRematchRecord(game: StoredGame): RematchRecord | null {
  const rematchGame = game.rematchGame;
  if (!rematchGame || !game.rematchRequestedBy) {
    return null;
  }

  return {
    joinCode: rematchGame.joinCode,
    requestedBy: game.rematchRequestedBy,
    requestedAt: game.rematchRequestedAt,
    waiting: !rematchGame.blackJoined || !rematchGame.whiteJoined,
    accepted: rematchGame.blackJoined && rematchGame.whiteJoined,
  };
}

function countOccupiedDiscs(board: Board): number {
  return board.reduce(
    (total, row) => total + row.filter((cell) => cell !== null).length,
    0,
  );
}

function calculateGameProgress(state: GameState): number {
  if (state.status === 'finished') {
    return 100;
  }

  const movesPlayed = Math.max(0, countOccupiedDiscs(state.board) - 4);
  return Math.max(0, Math.min(100, Math.round((movesPlayed / 60) * 100)));
}

function toSavedGameRecord(game: StoredGame, playerColor: Player): SavedGameRecord {
  return {
    id: game.id,
    joinCode: game.joinCode,
    state: game.state,
    version: game.version,
    playerColor,
    opponentJoined:
      playerColor === 'white' ? game.blackJoined : game.whiteJoined,
    playerName: playerColor === 'black' ? game.blackPlayerName : game.whitePlayerName,
    opponentName: playerColor === 'black' ? game.whitePlayerName : game.blackPlayerName,
    updatedAt: game.updatedAt,
    progress:
      game.endedReason === 'forfeit' || game.endedReason === 'cancelled'
        ? calculateGameProgress({ ...game.state, status: 'playing' })
        : calculateGameProgress(game.state),
    winner: game.winner,
    endedReason: game.endedReason,
    forfeitedBy: game.forfeitedBy,
    rematch: buildRematchRecord(game),
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

function isEndedReason(value: unknown): value is EndedReason {
  return value === 'normal' || value === 'forfeit' || value === 'cancelled';
}

function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed || trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
    return null;
  }

  return trimmed;
}

function parseOptionalDisplayName(value: unknown): string | undefined | null {
  if (value === undefined || value === null) {
    return undefined;
  }

  return normalizeDisplayName(value);
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

function positionToIndex(position: Position): number {
  return position.row * BOARD_SIZE + position.col;
}

function parseLastMove(row: GameRow): LastMove | null {
  const hasLastMoveColumns =
    row.last_move_version !== undefined ||
    row.last_move_player !== undefined ||
    row.last_move_placed_index !== undefined ||
    row.last_move_flipped_indices_json !== undefined;

  if (!hasLastMoveColumns) {
    return null;
  }

  if (
    row.last_move_version === null ||
    row.last_move_player === null ||
    row.last_move_placed_index === null ||
    row.last_move_flipped_indices_json === null ||
    row.last_move_version === undefined ||
    row.last_move_player === undefined ||
    row.last_move_placed_index === undefined ||
    row.last_move_flipped_indices_json === undefined
  ) {
    return null;
  }

  if (
    typeof row.last_move_version !== 'number' ||
    !Number.isInteger(row.last_move_version) ||
    row.last_move_version < 2 ||
    row.last_move_version > row.version ||
    !isPlayer(row.last_move_player) ||
    typeof row.last_move_placed_index !== 'number' ||
    !Number.isInteger(row.last_move_placed_index) ||
    row.last_move_placed_index < 0 ||
    row.last_move_placed_index >= BOARD_SIZE * BOARD_SIZE ||
    typeof row.last_move_flipped_indices_json !== 'string'
  ) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(row.last_move_flipped_indices_json);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) {
    return null;
  }

  const flippedIndices: number[] = [];
  const seenIndices = new Set<number>();
  for (const value of parsed) {
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < 0 ||
      value >= BOARD_SIZE * BOARD_SIZE ||
      seenIndices.has(value)
    ) {
      return null;
    }
    seenIndices.add(value);
    flippedIndices.push(value);
  }

  return {
    version: row.last_move_version,
    player: row.last_move_player,
    placedIndex: row.last_move_placed_index,
    flippedIndices,
  };
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
    row.white_joined !== 0 && row.white_joined !== 1 ||
    (row.black_joined !== undefined &&
      row.black_joined !== 0 &&
      row.black_joined !== 1) ||
    (row.rematch_of_game_id !== null &&
      row.rematch_of_game_id !== undefined &&
      typeof row.rematch_of_game_id !== 'string') ||
    (row.black_invite_token_digest !== null &&
      row.black_invite_token_digest !== undefined &&
      typeof row.black_invite_token_digest !== 'string') ||
    (row.ended_reason !== null &&
      row.ended_reason !== undefined &&
      !isEndedReason(row.ended_reason)) ||
    (row.forfeited_by !== null &&
      row.forfeited_by !== undefined &&
      !isPlayer(row.forfeited_by)) ||
    (row.rematch_game_id !== null &&
      row.rematch_game_id !== undefined &&
      typeof row.rematch_game_id !== 'string') ||
    (row.rematch_requested_by !== null &&
      row.rematch_requested_by !== undefined &&
      !isPlayer(row.rematch_requested_by)) ||
    (row.rematch_requested_at !== null &&
      row.rematch_requested_at !== undefined &&
      typeof row.rematch_requested_at !== 'string')
  ) {
    return null;
  }

  const board = parseBoard(row.board_json);
  if (!board) {
    return null;
  }

  const endedReason = row.ended_reason ?? 'normal';
  const forfeitedBy = row.forfeited_by ?? null;
  const winner = row.winner;
  if (winner !== null && !isGameResult(winner)) {
    return null;
  }

  if (
    (endedReason === 'forfeit' && !forfeitedBy) ||
    (endedReason !== 'forfeit' && forfeitedBy) ||
    (endedReason === 'cancelled' && winner !== null)
  ) {
    return null;
  }

  const resolvedState = resolveTurnState(board, row.current_player, row.consecutive_passes);
  const state: GameState =
    endedReason === 'forfeit' || endedReason === 'cancelled'
      ? {
          board,
          currentPlayer: row.current_player,
          status: 'finished',
          legalMoves: [],
          consecutivePasses: row.consecutive_passes,
        }
      : resolvedState;

  if (state.status !== row.status) {
    return null;
  }

  const scores = getScores(state.board);
  if (scores.black !== row.black_score || scores.white !== row.white_score) {
    return null;
  }

  const expectedWinner =
    state.status === 'finished'
      ? endedReason === 'forfeit'
        ? getOpponent(forfeitedBy!)
        : endedReason === 'cancelled'
          ? null
        : getGameResult(scores)
      : null;
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
    rematchOfGameId: row.rematch_of_game_id ?? null,
    blackJoined: row.black_joined === undefined ? true : row.black_joined === 1,
    blackInviteTokenDigest: row.black_invite_token_digest ?? '',
    lastMove: parseLastMove(row),
    blackPlayerName: normalizeDisplayName(row.black_player_name ?? null),
    whitePlayerName: normalizeDisplayName(row.white_player_name ?? null),
    endedReason,
    forfeitedBy,
    rematchGameId: row.rematch_game_id ?? null,
    rematchRequestedBy: row.rematch_requested_by ?? null,
    rematchRequestedAt: row.rematch_requested_at ?? null,
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

  const displayName = parseOptionalDisplayName(body.displayName);
  if (displayName === null) {
    return null;
  }

  return { inviteToken: body.inviteToken, displayName };
}

async function parseCreateGameRequest(request: Request): Promise<CreateGameRequest | null> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return {};
  }

  if (!isPlainObject(body)) {
    return null;
  }

  const displayName = parseOptionalDisplayName(body.displayName);
  return displayName === null ? null : { displayName };
}

async function parsePlayerProfileRequest(
  request: Request,
): Promise<PlayerProfileRequest | null> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return null;
  }

  if (!isPlainObject(body)) {
    return null;
  }

  const displayName = normalizeDisplayName(body.displayName);
  return displayName ? { displayName } : null;
}

async function parseSavedGamesRequest(
  request: Request,
): Promise<SavedGamesRequest | null> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return null;
  }

  if (!isPlainObject(body) || !Array.isArray(body.credentials)) {
    return null;
  }

  const credentials = body.credentials
    .filter(isPlainObject)
    .map((credential) => ({
      joinCode:
        typeof credential.joinCode === 'string'
          ? normalizeJoinCode(credential.joinCode)
          : '',
      playerToken:
        typeof credential.playerToken === 'string' ? credential.playerToken : '',
    }))
    .filter(
      (credential) =>
        isValidJoinCode(credential.joinCode) && credential.playerToken.length > 0,
    )
    .slice(0, 50);

  return { credentials };
}

async function parsePushSubscriptionRequest(
  request: Request,
): Promise<PushSubscriptionRequest | null> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return null;
  }

  if (!isPlainObject(body) || typeof body.endpoint !== 'string') {
    return null;
  }

  const keys = body.keys;
  if (
    !isPlainObject(keys) ||
    typeof keys.p256dh !== 'string' ||
    typeof keys.auth !== 'string'
  ) {
    return null;
  }

  try {
    const endpoint = new URL(body.endpoint);
    if (endpoint.protocol !== 'https:') {
      return null;
    }
  } catch {
    return null;
  }

  if (!body.endpoint || !keys.p256dh || !keys.auth) {
    return null;
  }

  return {
    endpoint: body.endpoint,
    keys: {
      p256dh: keys.p256dh,
      auth: keys.auth,
    },
  };
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
              white_invite_claimed_at, white_player_created_at,
              rematch_of_game_id, black_joined, black_invite_token_digest,
              black_invite_created_at, black_invite_claimed_at,
              last_move_version, last_move_player, last_move_placed_index,
              last_move_flipped_indices_json, black_player_name, white_player_name,
              ended_reason, forfeited_by, rematch_game_id,
              rematch_requested_by, rematch_requested_at
       FROM games
       WHERE join_code = ?`,
    )
    .bind(normalizedCode)
    .first<GameRow>();

  if (!row) {
    return null;
  }

  const game = rowToStoredGame(row);
  if (!game?.rematchGameId) {
    return game;
  }

  return {
    ...game,
    rematchGame: await getGameById(db, game.rematchGameId),
  };
}

async function getGameById(db: D1Database, id: string): Promise<StoredGame | null> {
  const row = await db
    .prepare(
      `SELECT id, join_code, board_json, current_player, status, winner,
              black_score, white_score, consecutive_passes, version,
              created_at, updated_at, black_player_token_digest,
              white_player_token_digest, white_invite_token_digest,
              white_joined, black_player_created_at, white_invite_created_at,
              white_invite_claimed_at, white_player_created_at,
              rematch_of_game_id, black_joined, black_invite_token_digest,
              black_invite_created_at, black_invite_claimed_at,
              last_move_version, last_move_player, last_move_placed_index,
              last_move_flipped_indices_json, black_player_name, white_player_name,
              ended_reason, forfeited_by, rematch_game_id,
              rematch_requested_by, rematch_requested_at
       FROM games
       WHERE id = ?`,
    )
    .bind(id)
    .first<GameRow>();

  return row ? rowToStoredGame(row) : null;
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
  options?: {
    readonly whiteTokenDigest?: string | null;
    readonly blackInviteTokenDigest?: string | null;
    readonly blackJoined?: boolean;
    readonly whiteJoined?: boolean;
    readonly rematchOfGameId?: string | null;
    readonly blackPlayerName?: string | null;
    readonly whitePlayerName?: string | null;
  },
): Promise<boolean> {
  const fields = gameStateToStorageFields(state);
  const now = new Date().toISOString();
  const version = 1;
  const blackJoined = options?.blackJoined ?? true;
  const whiteJoined = options?.whiteJoined ?? false;
  const blackInviteTokenDigest = options?.blackInviteTokenDigest ?? null;
  const whiteTokenDigest = options?.whiteTokenDigest ?? null;
  const rematchOfGameId = options?.rematchOfGameId ?? null;
  const blackPlayerName = normalizeDisplayName(options?.blackPlayerName ?? null);
  const whitePlayerName = normalizeDisplayName(options?.whitePlayerName ?? null);

  try {
    await db
      .prepare(
        `INSERT INTO games (
          id, join_code, board_json, current_player, status, winner,
          black_score, white_score, consecutive_passes, version,
          created_at, updated_at, black_player_token_digest,
          white_player_token_digest, white_invite_token_digest, white_joined,
          black_player_created_at, white_invite_created_at,
          white_invite_claimed_at, white_player_created_at,
          rematch_of_game_id, black_joined, black_invite_token_digest,
          black_invite_created_at, black_invite_claimed_at,
          last_move_version, last_move_player, last_move_placed_index,
          last_move_flipped_indices_json, black_player_name, white_player_name,
          ended_reason, forfeited_by, rematch_game_id, rematch_requested_by,
          rematch_requested_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        whiteTokenDigest,
        whiteInviteTokenDigest,
        whiteJoined ? 1 : 0,
        blackJoined ? now : null,
        whiteInviteTokenDigest ? now : null,
        null,
        whiteJoined ? now : null,
        rematchOfGameId,
        blackJoined ? 1 : 0,
        blackInviteTokenDigest,
        blackInviteTokenDigest ? now : null,
        null,
        null,
        null,
        null,
        null,
        blackPlayerName,
        whitePlayerName,
        null,
        null,
        null,
        null,
        null,
      )
      .run();
  } catch {
    return false;
  }

  return true;
}

async function createGame(
  db: D1Database,
  displayName?: string,
): Promise<GameRecord | null> {
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
      { blackPlayerName: displayName ?? null },
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

async function createRematchGame(
  db: D1Database,
  previousGame: StoredGame,
  requesterColor: Player,
  displayName?: string,
): Promise<GameRecord | null> {
  if (previousGame.rematchGame) {
    return toGameRecord(previousGame.rematchGame, undefined);
  }

  const state = createInitialGameState();
  const requesterNextColor: Player = requesterColor === 'black' ? 'white' : 'black';
  const blackToken = generateToken();
  const whiteToken = generateToken();
  const inviteToken = generateToken();
  const blackTokenDigest = await digestToken(blackToken);
  const whiteTokenDigest = await digestToken(whiteToken);
  const inviteTokenDigest = await digestToken(inviteToken);

  for (let attempt = 0; attempt < MAX_JOIN_CODE_ATTEMPTS; attempt += 1) {
    const id = crypto.randomUUID();
    const joinCode = generateJoinCode();
    const didInsert = await insertGame(
      db,
      id,
      joinCode,
      state,
      requesterNextColor === 'black' ? blackTokenDigest : '',
      requesterNextColor === 'black' ? inviteTokenDigest : '',
      requesterNextColor === 'black'
        ? {
            blackJoined: true,
            whiteJoined: false,
            rematchOfGameId: previousGame.id,
            blackPlayerName: displayName ?? null,
          }
        : {
            blackJoined: false,
            whiteJoined: true,
            whiteTokenDigest,
            blackInviteTokenDigest: inviteTokenDigest,
            rematchOfGameId: previousGame.id,
            whitePlayerName: displayName ?? null,
          },
    );

    if (didInsert) {
      const game = await getGameByJoinCode(db, joinCode);
      if (!game) {
        return null;
      }

      const didLink = await linkRematchGame(db, previousGame, game.id, requesterColor);
      if (!didLink) {
        const refreshedPreviousGame = await getGameByJoinCode(db, previousGame.joinCode);
        return refreshedPreviousGame?.rematchGame
          ? toGameRecord(refreshedPreviousGame.rematchGame, undefined)
          : null;
      }

      return toGameRecord(game, requesterNextColor, {
        playerToken: requesterNextColor === 'black' ? blackToken : whiteToken,
        invitation: `${joinCode}:${inviteToken}`,
      });
    }
  }

  return null;
}

async function linkRematchGame(
  db: D1Database,
  previousGame: StoredGame,
  rematchGameId: string,
  requesterColor: Player,
): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE games
       SET rematch_game_id = ?,
           rematch_requested_by = ?,
           rematch_requested_at = ?,
           updated_at = ?,
           version = ?
       WHERE id = ? AND join_code = ? AND rematch_game_id IS NULL
         AND status = ? AND version = ?`,
    )
    .bind(
      rematchGameId,
      requesterColor,
      now,
      now,
      previousGame.version + 1,
      previousGame.id,
      previousGame.joinCode,
      'finished',
      previousGame.version,
    )
    .run();

  return (result.meta.changes ?? 0) > 0;
}

async function claimWhite(
  db: D1Database,
  game: StoredGame,
  inviteTokenDigest: string,
  whiteTokenDigest: string,
  displayName?: string,
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
           white_player_name = ?,
           updated_at = ?
       WHERE id = ? AND join_code = ? AND white_joined = 0
         AND white_invite_token_digest = ?`,
    )
    .bind(
      whiteTokenDigest,
      game.version + 1,
      now,
      now,
      displayName ?? null,
      now,
      game.id,
      game.joinCode,
      inviteTokenDigest,
    )
    .run();

  return (result.meta.changes ?? 0) > 0;
}

async function claimBlack(
  db: D1Database,
  game: StoredGame,
  inviteTokenDigest: string,
  blackTokenDigest: string,
  displayName?: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE games
       SET black_player_token_digest = ?,
           black_joined = 1,
           black_invite_token_digest = NULL,
           version = ?,
           black_invite_claimed_at = ?,
           black_player_created_at = ?,
           black_player_name = ?,
           updated_at = ?
       WHERE id = ? AND join_code = ? AND black_joined = 0
         AND black_invite_token_digest = ?`,
    )
    .bind(
      blackTokenDigest,
      game.version + 1,
      now,
      now,
      displayName ?? null,
      now,
      game.id,
      game.joinCode,
      inviteTokenDigest,
    )
    .run();

  return (result.meta.changes ?? 0) > 0;
}

async function upsertPushSubscription(
  db: D1Database,
  game: StoredGame,
  playerColor: Player,
  subscription: PushSubscriptionRequest,
): Promise<void> {
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO push_subscriptions (
         id, game_id, player_color, endpoint, p256dh, auth, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(game_id, player_color, endpoint) DO UPDATE SET
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      game.id,
      playerColor,
      subscription.endpoint,
      subscription.keys.p256dh,
      subscription.keys.auth,
      now,
      now,
    )
    .run();
}

async function deletePushSubscription(
  db: D1Database,
  game: StoredGame,
  playerColor: Player,
  endpoint: string,
): Promise<void> {
  await db
    .prepare(
      `DELETE FROM push_subscriptions
       WHERE game_id = ? AND player_color = ? AND endpoint = ?`,
    )
    .bind(game.id, playerColor, endpoint)
    .run();
}

export function deriveNotificationEvent({
  previousGame,
  updatedGame,
  actorPlayerColor,
  eventType,
}: {
  readonly previousGame: StoredGame;
  readonly updatedGame: StoredGame;
  readonly actorPlayerColor: Player;
  readonly eventType: 'join' | 'move' | 'forfeit';
}): NotificationEvent | null {
  if (eventType === 'join') {
    if (
      actorPlayerColor === 'white' &&
      !previousGame.whiteJoined &&
      updatedGame.whiteJoined
    ) {
      return {
        eventType: 'white_joined',
        recipientPlayerColor: 'black',
        title: 'White joined your Othello game',
        body: 'The game is ready. It is your turn.',
      };
    }

    return null;
  }

  if (updatedGame.state.status === 'finished') {
    const recipientPlayerColor = actorPlayerColor === 'black' ? 'white' : 'black';
    const winner = updatedGame.winner;
    if (updatedGame.endedReason === 'forfeit') {
      const actorName =
        actorPlayerColor === 'black'
          ? updatedGame.blackPlayerName
          : updatedGame.whitePlayerName;
      return {
        eventType: 'game_finished',
        recipientPlayerColor,
        title: 'Othello game forfeited',
        body: `${actorName || 'Your opponent'} forfeited. You win the game.`,
      };
    }

    const body =
      winner === 'draw'
        ? 'The game ended in a draw.'
        : winner === recipientPlayerColor
          ? 'You win.'
          : 'You lose.';

    return {
      eventType: 'game_finished',
      recipientPlayerColor,
      title: 'Othello game finished',
      body,
    };
  }

  if (updatedGame.state.currentPlayer !== actorPlayerColor) {
    return {
      eventType: 'your_turn',
      recipientPlayerColor: updatedGame.state.currentPlayer,
      title: 'Your turn in Othello',
      body: 'Your opponent made a move.',
    };
  }

  return null;
}

async function createPendingNotificationEvent(
  db: D1Database,
  game: StoredGame,
  notification: NotificationEvent,
): Promise<string | null> {
  const existingEvent = await db
    .prepare(
      `SELECT id, delivery_state, attempts
       FROM push_notification_events
       WHERE game_id = ? AND game_version = ? AND event_type = ?
         AND recipient_player_color = ?`,
    )
    .bind(
      game.id,
      game.version,
      notification.eventType,
      notification.recipientPlayerColor,
    )
    .first<PushNotificationEventRow>();

  if (existingEvent) {
    if (
      existingEvent.delivery_state !== 'failed' ||
      existingEvent.attempts >= MAX_NOTIFICATION_ATTEMPTS
    ) {
      return null;
    }

    return existingEvent.id;
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  try {
    await db
      .prepare(
        `INSERT INTO push_notification_events (
           id, game_id, game_version, event_type, recipient_player_color,
           delivery_state, attempts, last_error, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        game.id,
        game.version,
        notification.eventType,
        notification.recipientPlayerColor,
        'pending',
        0,
        null,
        now,
        now,
      )
      .run();
  } catch {
    return null;
  }

  return id;
}

async function listPushSubscriptions(
  db: D1Database,
  gameId: string,
  playerColor: Player,
): Promise<PushSubscriptionRow[]> {
  const result = await db
    .prepare(
      `SELECT id, endpoint, p256dh, auth
       FROM push_subscriptions
       WHERE game_id = ? AND player_color = ?`,
    )
    .bind(gameId, playerColor)
    .all<PushSubscriptionRow>();

  return result.results ?? [];
}

async function updateNotificationDeliveryState(
  db: D1Database,
  eventId: string,
  deliveryState: 'sent' | 'failed',
  attempts: number,
  lastError: string | null,
): Promise<void> {
  await db
    .prepare(
      `UPDATE push_notification_events
       SET delivery_state = ?, attempts = ?, last_error = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(deliveryState, attempts, lastError, new Date().toISOString(), eventId)
    .run();
}

async function removePermanentPushFailure(
  db: D1Database,
  subscriptionId: string,
): Promise<void> {
  await db
    .prepare('DELETE FROM push_subscriptions WHERE id = ?')
    .bind(subscriptionId)
    .run();
}

export async function sendNotificationEvent(
  db: D1Database,
  env: WorkerEnv,
  game: StoredGame,
  notification: NotificationEvent,
): Promise<void> {
  if (!isPushConfigured(env)) {
    return;
  }

  const eventId = await createPendingNotificationEvent(db, game, notification);
  if (!eventId) {
    return;
  }

  const subscriptions = await listPushSubscriptions(
    db,
    game.id,
    notification.recipientPlayerColor,
  );

  if (subscriptions.length === 0) {
    await updateNotificationDeliveryState(db, eventId, 'failed', 1, 'No subscriptions');
    return;
  }

  let didSend = false;
  let lastError: string | null = null;

  for (const subscription of subscriptions) {
    try {
      const request = await buildPushHTTPRequest({
        privateJWK: env.VAPID_PRIVATE_KEY!,
        subscription: {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth,
          },
        } satisfies WebPushSubscription,
        message: {
          payload: {
            title: notification.title,
            body: notification.body,
            icon: '/pwa-icon-192.png',
            badge: '/pwa-icon-192.png',
            tag: `${game.id}-${game.version}-${notification.eventType}`,
            data: {
              url: `/?game=${encodeURIComponent(game.joinCode)}`,
              joinCode: game.joinCode,
            },
          },
          adminContact: env.VAPID_SUBJECT!,
          options: {
            ttl: 60 * 60,
            urgency: 'normal',
            topic: `${game.id}-${game.version}-${notification.eventType}`,
          },
        },
      });

      const response = await fetch(request.endpoint, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
      });

      if (response.ok || response.status === 201 || response.status === 202) {
        didSend = true;
        continue;
      }

      lastError = `Push service returned ${response.status}`;
      if (response.status === 404 || response.status === 410) {
        await removePermanentPushFailure(db, subscription.id);
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Push delivery failed';
    }
  }

  await updateNotificationDeliveryState(
    db,
    eventId,
    didSend ? 'sent' : 'failed',
    Math.min(MAX_NOTIFICATION_ATTEMPTS, 1),
    didSend ? null : lastError,
  );
}

async function persistMove(
  db: D1Database,
  game: StoredGame,
  nextState: GameState,
  lastMove: LastMove | null,
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
           last_move_version = ?,
           last_move_player = ?,
           last_move_placed_index = ?,
           last_move_flipped_indices_json = ?,
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
      lastMove?.version ?? null,
      lastMove?.player ?? null,
      lastMove?.placedIndex ?? null,
      lastMove ? JSON.stringify(lastMove.flippedIndices) : null,
      updatedAt,
      game.id,
      game.joinCode,
      game.version,
    )
    .run();

  return (result.meta.changes ?? 0) > 0;
}

function simulateGameToEnd(game: StoredGame): {
  readonly state: GameState;
  readonly lastMove: LastMove | null;
} {
  let state = game.state;
  let version = game.version;
  let lastMove: LastMove | null = null;

  while (state.status !== 'finished') {
    const move = state.legalMoves[0];
    if (!move) {
      break;
    }

    const player = state.currentPlayer;
    const flips = getAllFlips(state.board, move, player);
    const nextState = applyMove(state, move);
    if (!nextState) {
      break;
    }

    version += 1;
    lastMove = {
      version,
      player,
      placedIndex: positionToIndex(move),
      flippedIndices: flips.map(positionToIndex),
    };
    state = nextState;
  }

  return { state, lastMove };
}

async function handleJoin(
  request: Request,
  db: D1Database,
  env: WorkerEnv,
  ctx: ExecutionContext,
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
    if (game.blackJoined) {
      return errorResponse(409, 'Game already joined');
    }
  }

  const inviteDigest = await digestToken(joinRequest.inviteToken);
  const invitedColor: Player | null =
    !game.whiteJoined && inviteDigest === game.whiteInviteTokenDigest
      ? 'white'
      : !game.blackJoined && inviteDigest === game.blackInviteTokenDigest
        ? 'black'
        : null;

  if (!invitedColor) {
    return errorResponse(403, 'Invalid invitation token');
  }

  const playerToken = generateToken();
  const playerTokenDigest = await digestToken(playerToken);
  const didClaim =
    invitedColor === 'white'
      ? await claimWhite(
          db,
          game,
          inviteDigest,
          playerTokenDigest,
          joinRequest.displayName,
        )
      : await claimBlack(
          db,
          game,
          inviteDigest,
          playerTokenDigest,
          joinRequest.displayName,
        );
  if (!didClaim) {
    return errorResponse(409, 'Game already joined');
  }

  const updatedGame = await getGameByJoinCode(db, game.joinCode);
  if (!updatedGame) {
    return errorResponse(404, 'Game not found');
  }

  const notification = deriveNotificationEvent({
    previousGame: game,
    updatedGame,
    actorPlayerColor: 'white',
    eventType: 'join',
  });
  if (notification) {
    ctx.waitUntil(sendNotificationEvent(db, env, updatedGame, notification));
  }

  return jsonResponse(
    toGameRecord(updatedGame, invitedColor, { playerToken }),
  );
}

async function handleMove(
  request: Request,
  db: D1Database,
  env: WorkerEnv,
  ctx: ExecutionContext,
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
  if (!game.whiteJoined || !game.blackJoined) {
    return errorResponse(403, 'Waiting for opponent to join');
  }
  if (playerColor !== game.state.currentPlayer) {
    return errorResponse(403, 'Not your turn');
  }
  if (moveRequest.expectedVersion !== game.version) {
    return errorResponse(409, 'Stale game version');
  }

  const move: Position = { row: moveRequest.row, col: moveRequest.col };
  const flips = getAllFlips(game.state.board, move, playerColor);
  const nextState = applyMove(game.state, move);

  if (!nextState) {
    return errorResponse(422, 'Illegal move');
  }

  const lastMove: LastMove = {
    version: game.version + 1,
    player: playerColor,
    placedIndex: positionToIndex(move),
    flippedIndices: flips.map(positionToIndex),
  };
  const didPersist = await persistMove(db, game, nextState, lastMove);
  if (!didPersist) {
    return errorResponse(409, 'Stale game version');
  }

  const persistedGame = await getGameByJoinCode(db, game.joinCode);
  if (!persistedGame) {
    return errorResponse(404, 'Game not found');
  }

  const notification = deriveNotificationEvent({
    previousGame: game,
    updatedGame: persistedGame,
    actorPlayerColor: playerColor,
    eventType: 'move',
  });
  if (notification) {
    ctx.waitUntil(sendNotificationEvent(db, env, persistedGame, notification));
  }

  return jsonResponse(toGameRecord(persistedGame, playerColor));
}

async function handleRematch(
  request: Request,
  db: D1Database,
  env: WorkerEnv,
  ctx: ExecutionContext,
  joinCode: string,
): Promise<Response> {
  const authResult = await authenticateGame(request, db, joinCode);
  if (authResult instanceof Response) {
    return authResult;
  }

  const { game, playerColor } = authResult;
  if (game.state.status !== 'finished') {
    return errorResponse(409, 'Game is not finished');
  }

  const createGameRequest = await parseCreateGameRequest(request);
  if (!createGameRequest) {
    return errorResponse(400, 'Malformed rematch request');
  }
  const { displayName } = createGameRequest;
  const rematch = await createRematchGame(db, game, playerColor, displayName);
  if (!rematch) {
    return errorResponse(500, 'Unable to create rematch');
  }

  const updatedGame = await getGameByJoinCode(db, game.joinCode);
  if (updatedGame?.rematchGame && !game.rematchGame) {
    const notification = {
      eventType: 'rematch_requested' as const,
      recipientPlayerColor: getOpponent(playerColor),
      title: 'Othello rematch requested',
      body: `${
        playerColor === 'black' ? game.blackPlayerName : game.whitePlayerName
      || 'Your opponent'} wants to play again.`,
    };
    ctx.waitUntil(sendNotificationEvent(db, env, updatedGame, notification));
  }

  return jsonResponse(rematch, { status: 201 });
}

async function handleAcceptRematch(
  request: Request,
  db: D1Database,
  joinCode: string,
): Promise<Response> {
  const authResult = await authenticateGame(request, db, joinCode);
  if (authResult instanceof Response) {
    return authResult;
  }

  const { game, playerColor } = authResult;
  const rematchGame = game.rematchGame;
  if (!rematchGame || !game.rematchRequestedBy) {
    return errorResponse(404, 'Rematch not found');
  }
  if (game.rematchRequestedBy === playerColor) {
    return errorResponse(409, 'Waiting for opponent to accept');
  }

  const nextColor: Player = playerColor === 'black' ? 'white' : 'black';
  if (rematchGame.blackJoined && rematchGame.whiteJoined) {
    return jsonResponse(toGameRecord(rematchGame, nextColor));
  }

  const playerToken = generateToken();
  const playerTokenDigest = await digestToken(playerToken);
  const displayName =
    playerColor === 'black' ? game.blackPlayerName ?? undefined : game.whitePlayerName ?? undefined;
  const didClaim =
    nextColor === 'black'
      ? await claimBlack(
          db,
          rematchGame,
          rematchGame.blackInviteTokenDigest,
          playerTokenDigest,
          displayName,
        )
      : await claimWhite(
          db,
          rematchGame,
          rematchGame.whiteInviteTokenDigest,
          playerTokenDigest,
          displayName,
        );
  if (!didClaim) {
    return errorResponse(409, 'Rematch already accepted');
  }

  const acceptedGame = await getGameByJoinCode(db, rematchGame.joinCode);
  if (!acceptedGame) {
    return errorResponse(404, 'Rematch not found');
  }

  return jsonResponse(toGameRecord(acceptedGame, nextColor, { playerToken }));
}

async function handleForfeit(
  request: Request,
  db: D1Database,
  env: WorkerEnv,
  ctx: ExecutionContext,
  joinCode: string,
): Promise<Response> {
  const authResult = await authenticateGame(request, db, joinCode);
  if (authResult instanceof Response) {
    return authResult;
  }

  const { game, playerColor } = authResult;
  if (!game.blackJoined || !game.whiteJoined) {
    return errorResponse(409, 'Waiting for opponent to join');
  }
  if (game.state.status === 'finished') {
    return errorResponse(409, 'Game is already finished');
  }

  const didPersist = await persistForfeit(db, game, playerColor);
  if (!didPersist) {
    return errorResponse(409, 'Game is already finished');
  }

  const persistedGame = await getGameByJoinCode(db, game.joinCode);
  if (!persistedGame) {
    return errorResponse(404, 'Game not found');
  }

  const notification = deriveNotificationEvent({
    previousGame: game,
    updatedGame: persistedGame,
    actorPlayerColor: playerColor,
    eventType: 'forfeit',
  });
  if (notification) {
    ctx.waitUntil(sendNotificationEvent(db, env, persistedGame, notification));
  }

  return jsonResponse(toGameRecord(persistedGame, playerColor));
}

async function handleCancelGame(
  request: Request,
  db: D1Database,
  joinCode: string,
): Promise<Response> {
  const authResult = await authenticateGame(request, db, joinCode);
  if (authResult instanceof Response) {
    return authResult;
  }

  const { game, playerColor } = authResult;
  if (playerColor !== 'black') {
    return errorResponse(403, 'Only the creator can cancel this game');
  }
  if (game.state.status === 'finished') {
    return errorResponse(409, 'Game is already finished');
  }
  if (game.whiteJoined) {
    return errorResponse(409, 'Game already joined');
  }

  const didPersist = await persistCancellation(db, game);
  if (!didPersist) {
    return errorResponse(409, 'Game can no longer be cancelled');
  }

  const persistedGame = await getGameByJoinCode(db, game.joinCode);
  if (!persistedGame) {
    return errorResponse(404, 'Game not found');
  }

  return jsonResponse(toGameRecord(persistedGame, playerColor));
}

async function handleSavedGames(request: Request, db: D1Database): Promise<Response> {
  const savedGamesRequest = await parseSavedGamesRequest(request);
  if (!savedGamesRequest) {
    return errorResponse(400, 'Malformed saved games request');
  }

  const games: SavedGameRecord[] = [];
  const seenCodes = new Set<string>();

  for (const credential of savedGamesRequest.credentials) {
    if (seenCodes.has(credential.joinCode)) {
      continue;
    }
    seenCodes.add(credential.joinCode);

    const game = await getGameByJoinCode(db, credential.joinCode);
    if (!game) {
      continue;
    }

    const tokenDigest = await digestToken(credential.playerToken);
    const playerColor =
      tokenDigest === game.blackPlayerTokenDigest
        ? 'black'
        : game.whitePlayerTokenDigest && tokenDigest === game.whitePlayerTokenDigest
          ? 'white'
          : null;

    if (playerColor) {
      games.push(toSavedGameRecord(game, playerColor));
    }
  }

  games.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return jsonResponse({ games });
}

async function updatePlayerName(
  db: D1Database,
  game: StoredGame,
  playerColor: Player,
  displayName: string,
): Promise<boolean> {
  const column = playerColor === 'black' ? 'black_player_name' : 'white_player_name';
  const result = await db
    .prepare(
      `UPDATE games
       SET ${column} = ?, updated_at = ?
       WHERE id = ? AND join_code = ?`,
    )
    .bind(displayName, new Date().toISOString(), game.id, game.joinCode)
    .run();

  return (result.meta.changes ?? 0) > 0;
}

async function persistForfeit(
  db: D1Database,
  game: StoredGame,
  forfeitingPlayer: Player,
): Promise<boolean> {
  const updatedAt = new Date().toISOString();
  const winner = getOpponent(forfeitingPlayer);
  const nextVersion = game.version + 1;
  const result = await db
    .prepare(
      `UPDATE games
       SET status = ?,
           winner = ?,
           version = ?,
           ended_reason = ?,
           forfeited_by = ?,
           last_move_version = NULL,
           last_move_player = NULL,
           last_move_placed_index = NULL,
           last_move_flipped_indices_json = NULL,
           updated_at = ?
       WHERE id = ? AND join_code = ? AND status = ? AND version = ?`,
    )
    .bind(
      'finished',
      winner,
      nextVersion,
      'forfeit',
      forfeitingPlayer,
      updatedAt,
      game.id,
      game.joinCode,
      'playing',
      game.version,
    )
    .run();

  return (result.meta.changes ?? 0) > 0;
}

async function persistCancellation(
  db: D1Database,
  game: StoredGame,
): Promise<boolean> {
  const updatedAt = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE games
       SET status = ?,
           winner = NULL,
           version = ?,
           ended_reason = ?,
           forfeited_by = NULL,
           white_invite_token_digest = NULL,
           black_invite_token_digest = NULL,
           last_move_version = NULL,
           last_move_player = NULL,
           last_move_placed_index = NULL,
           last_move_flipped_indices_json = NULL,
           updated_at = ?
       WHERE id = ? AND join_code = ? AND status = ? AND version = ?
         AND black_joined = 1 AND white_joined = 0`,
    )
    .bind(
      'finished',
      game.version + 1,
      'cancelled',
      updatedAt,
      game.id,
      game.joinCode,
      'playing',
      game.version,
    )
    .run();

  return (result.meta.changes ?? 0) > 0;
}

async function handlePlayerProfile(
  request: Request,
  db: D1Database,
  joinCode: string,
): Promise<Response> {
  const profileRequest = await parsePlayerProfileRequest(request);
  if (!profileRequest) {
    return errorResponse(400, 'Malformed player profile');
  }

  const authResult = await authenticateGame(request, db, joinCode);
  if (authResult instanceof Response) {
    return authResult;
  }

  const didUpdate = await updatePlayerName(
    db,
    authResult.game,
    authResult.playerColor,
    profileRequest.displayName,
  );
  if (!didUpdate) {
    return errorResponse(404, 'Game not found');
  }

  const updatedGame = await getGameByJoinCode(db, authResult.game.joinCode);
  if (!updatedGame) {
    return errorResponse(404, 'Game not found');
  }

  return jsonResponse(toGameRecord(updatedGame, authResult.playerColor));
}

async function handleSkipToEnd(
  request: Request,
  db: D1Database,
  env: WorkerEnv,
  joinCode: string,
): Promise<Response> {
  if (!isTestControlsEnabled(env)) {
    return errorResponse(404, 'Not found');
  }

  const authResult = await authenticateGame(request, db, joinCode);
  if (authResult instanceof Response) {
    return authResult;
  }

  const { game, playerColor } = authResult;
  if (game.state.status === 'finished') {
    return errorResponse(409, 'Game is already finished');
  }

  const simulated = simulateGameToEnd(game);
  if (simulated.state.status !== 'finished') {
    return errorResponse(500, 'Unable to finish game');
  }

  const lastMove = simulated.lastMove
    ? { ...simulated.lastMove, version: game.version + 1 }
    : null;
  const didPersist = await persistMove(db, game, simulated.state, lastMove);
  if (!didPersist) {
    return errorResponse(409, 'Stale game version');
  }

  const persistedGame = await getGameByJoinCode(db, game.joinCode);
  if (!persistedGame) {
    return errorResponse(404, 'Game not found');
  }

  return jsonResponse(toGameRecord(persistedGame, playerColor));
}

async function handleSubscribe(
  request: Request,
  db: D1Database,
  joinCode: string,
): Promise<Response> {
  const subscription = await parsePushSubscriptionRequest(request);
  if (!subscription) {
    return errorResponse(400, 'Malformed push subscription');
  }

  const authResult = await authenticateGame(request, db, joinCode);
  if (authResult instanceof Response) {
    return authResult;
  }

  await upsertPushSubscription(
    db,
    authResult.game,
    authResult.playerColor,
    subscription,
  );

  return jsonResponse({ enabled: true });
}

async function handleUnsubscribe(
  request: Request,
  db: D1Database,
  joinCode: string,
): Promise<Response> {
  const subscription = await parsePushSubscriptionRequest(request);
  if (!subscription) {
    return errorResponse(400, 'Malformed push subscription');
  }

  const authResult = await authenticateGame(request, db, joinCode);
  if (authResult instanceof Response) {
    return authResult;
  }

  await deletePushSubscription(
    db,
    authResult.game,
    authResult.playerColor,
    subscription.endpoint,
  );

  return jsonResponse({ enabled: false });
}

function parseGamePath(pathname: string):
  | {
      readonly code: string;
      readonly action:
        | 'read'
        | 'move'
        | 'join'
        | 'push'
        | 'rematch'
        | 'forfeit'
        | 'cancel'
        | 'skip-to-end'
        | 'player-profile';
    }
  | null {
  const match = /^\/api\/games\/([^/]+)(?:\/(moves|join|push-subscriptions|rematch|forfeit|cancel|test\/skip-to-end|player-profile))?$/.exec(pathname);
  if (!match) {
    return null;
  }

  const suffix = match[2];
  return {
    code: decodeURIComponent(match[1]),
    action:
      suffix === 'moves'
        ? 'move'
        : suffix === 'join'
          ? 'join'
          : suffix === 'push-subscriptions'
            ? 'push'
            : suffix === 'rematch'
              ? 'rematch'
              : suffix === 'forfeit'
                ? 'forfeit'
                : suffix === 'cancel'
                  ? 'cancel'
                  : suffix === 'test/skip-to-end'
                    ? 'skip-to-end'
                    : suffix === 'player-profile'
                      ? 'player-profile'
                      : 'read',
  };
}

async function routeApiRequest(
  request: Request,
  env: WorkerEnv,
  ctx: ExecutionContext,
  url: URL,
): Promise<Response> {
  if (url.pathname === '/api/push/public-key' && request.method === 'GET') {
    return jsonResponse({
      enabled: isPushConfigured(env),
      publicKey: env.VAPID_PUBLIC_KEY ?? null,
    });
  }

  if (url.pathname === '/api/test-controls' && request.method === 'GET') {
    return jsonResponse({ enabled: isTestControlsEnabled(env) });
  }

  if (url.pathname === '/api/games/saved' && request.method === 'POST') {
    return handleSavedGames(request, env.DB);
  }

  if (url.pathname === '/api/games' && request.method === 'POST') {
    const createGameRequest = await parseCreateGameRequest(request);
    if (!createGameRequest) {
      return errorResponse(400, 'Malformed game request');
    }
    const { displayName } = createGameRequest;
    const game = await createGame(env.DB, displayName);
    if (!game) {
      return errorResponse(500, 'Unable to create game');
    }

    return jsonResponse(game, { status: 201 });
  }

  const rematchAcceptMatch = /^\/api\/games\/([^/]+)\/rematch\/accept$/.exec(
    url.pathname,
  );
  if (rematchAcceptMatch && request.method === 'POST') {
    return handleAcceptRematch(request, env.DB, decodeURIComponent(rematchAcceptMatch[1]));
  }

  const gamePath = parseGamePath(url.pathname);
  if (gamePath?.action === 'join' && request.method === 'POST') {
    return handleJoin(request, env.DB, env, ctx, gamePath.code);
  }

  if (gamePath?.action === 'read' && request.method === 'GET') {
    const authResult = await authenticateGame(request, env.DB, gamePath.code);
    if (authResult instanceof Response) {
      return authResult;
    }

    return jsonResponse(toGameRecord(authResult.game, authResult.playerColor));
  }

  if (gamePath?.action === 'move' && request.method === 'POST') {
    return handleMove(request, env.DB, env, ctx, gamePath.code);
  }

  if (gamePath?.action === 'push' && request.method === 'POST') {
    if (!isPushConfigured(env)) {
      return errorResponse(503, 'Push notifications are not configured');
    }

    return handleSubscribe(request, env.DB, gamePath.code);
  }

  if (gamePath?.action === 'push' && request.method === 'DELETE') {
    return handleUnsubscribe(request, env.DB, gamePath.code);
  }

  if (gamePath?.action === 'rematch' && request.method === 'POST') {
    return handleRematch(request, env.DB, env, ctx, gamePath.code);
  }

  if (gamePath?.action === 'forfeit' && request.method === 'POST') {
    return handleForfeit(request, env.DB, env, ctx, gamePath.code);
  }

  if (gamePath?.action === 'cancel' && request.method === 'POST') {
    return handleCancelGame(request, env.DB, gamePath.code);
  }

  if (gamePath?.action === 'player-profile' && request.method === 'PATCH') {
    return handlePlayerProfile(request, env.DB, gamePath.code);
  }

  if (gamePath?.action === 'skip-to-end' && request.method === 'POST') {
    return handleSkipToEnd(request, env.DB, env, gamePath.code);
  }

  return errorResponse(404, 'Not found');
}

export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return routeApiRequest(request, env, ctx, url);
    }

    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<WorkerEnv>;
