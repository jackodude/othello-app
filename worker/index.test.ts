import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createInitialGameState } from '../src/game';
import worker, { deriveNotificationEvent, sendNotificationEvent } from './index';

const API_ORIGIN = 'https://othello.test';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

type StoredRow = Record<string, unknown>;

class FakeD1PreparedStatement {
  private params: unknown[] = [];
  private readonly sql: string;
  private readonly db: FakeD1Database;

  constructor(sql: string, db: FakeD1Database) {
    this.sql = sql;
    this.db = db;
  }

  bind(...params: unknown[]): D1PreparedStatement {
    this.params = params;
    return this as unknown as D1PreparedStatement;
  }

  async first<T = unknown>(): Promise<T | null> {
    if (this.sql.includes('FROM push_notification_events')) {
      const [gameId, gameVersion, eventType, recipientPlayerColor] = this.params;
      const event = this.db.pushNotificationEvents.find(
        (notificationEvent) =>
          notificationEvent.game_id === gameId &&
          notificationEvent.game_version === gameVersion &&
          notificationEvent.event_type === eventType &&
          notificationEvent.recipient_player_color === recipientPlayerColor,
      );

      return event
        ? ({
            id: event.id,
            delivery_state: event.delivery_state,
            attempts: event.attempts,
          } as T)
        : null;
    }

    if (!this.sql.includes('SELECT')) {
      throw new Error(`Unsupported first() SQL: ${this.sql}`);
    }

    const code = String(this.params[0]).toUpperCase();
    const row = this.db.rowsByCode.get(code);

    return row ? ({ ...row } as T) : null;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    if (this.sql.includes('FROM push_subscriptions')) {
      const gameId = this.params[0];
      const playerColor = this.params[1];
      const results = this.db.pushSubscriptions
        .filter(
          (subscription) =>
            subscription.game_id === gameId &&
            subscription.player_color === playerColor,
        )
        .map((subscription) => ({
          id: subscription.id,
          endpoint: subscription.endpoint,
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        })) as T[];

      return {
        ...makeD1Result(0),
        results,
      };
    }

    throw new Error(`Unsupported all() SQL: ${this.sql}`);
  }

  async run(): Promise<D1Result> {
    if (this.sql.includes('INSERT INTO push_subscriptions')) {
      const [id, gameId, playerColor, endpoint, p256dh, auth, createdAt, updatedAt] =
        this.params;
      const existingIndex = this.db.pushSubscriptions.findIndex(
        (subscription) =>
          subscription.game_id === gameId &&
          subscription.player_color === playerColor &&
          subscription.endpoint === endpoint,
      );

      const row = {
        id,
        game_id: gameId,
        player_color: playerColor,
        endpoint,
        p256dh,
        auth,
        created_at: createdAt,
        updated_at: updatedAt,
      };

      if (existingIndex >= 0) {
        this.db.pushSubscriptions[existingIndex] = {
          ...this.db.pushSubscriptions[existingIndex],
          p256dh,
          auth,
          updated_at: updatedAt,
        };
      } else {
        this.db.pushSubscriptions.push(row);
      }

      return makeD1Result(1);
    }

    if (this.sql.includes('DELETE FROM push_subscriptions WHERE id = ?')) {
      const id = this.params[0];
      const before = this.db.pushSubscriptions.length;
      this.db.pushSubscriptions = this.db.pushSubscriptions.filter(
        (subscription) => subscription.id !== id,
      );
      return makeD1Result(before - this.db.pushSubscriptions.length);
    }

    if (this.sql.includes('DELETE FROM push_subscriptions')) {
      const [gameId, playerColor, endpoint] = this.params;
      const before = this.db.pushSubscriptions.length;
      this.db.pushSubscriptions = this.db.pushSubscriptions.filter(
        (subscription) =>
          subscription.game_id !== gameId ||
          subscription.player_color !== playerColor ||
          subscription.endpoint !== endpoint,
      );
      return makeD1Result(before - this.db.pushSubscriptions.length);
    }

    if (this.sql.includes('INSERT INTO push_notification_events')) {
      const [
        id,
        gameId,
        gameVersion,
        eventType,
        recipientPlayerColor,
        deliveryState,
        attempts,
        lastError,
        createdAt,
        updatedAt,
      ] = this.params;
      const exists = this.db.pushNotificationEvents.some(
        (event) =>
          event.game_id === gameId &&
          event.game_version === gameVersion &&
          event.event_type === eventType &&
          event.recipient_player_color === recipientPlayerColor,
      );

      if (exists) {
        throw new Error('UNIQUE constraint failed: push_notification_events');
      }

      this.db.pushNotificationEvents.push({
        id,
        game_id: gameId,
        game_version: gameVersion,
        event_type: eventType,
        recipient_player_color: recipientPlayerColor,
        delivery_state: deliveryState,
        attempts,
        last_error: lastError,
        created_at: createdAt,
        updated_at: updatedAt,
      });

      return makeD1Result(1);
    }

    if (this.sql.includes('UPDATE push_notification_events')) {
      const [deliveryState, attempts, lastError, updatedAt, id] = this.params;
      const event = this.db.pushNotificationEvents.find(
        (notificationEvent) => notificationEvent.id === id,
      );
      if (!event) {
        return makeD1Result(0);
      }

      event.delivery_state = deliveryState;
      event.attempts = attempts;
      event.last_error = lastError;
      event.updated_at = updatedAt;

      return makeD1Result(1);
    }

    if (this.sql.includes('INSERT INTO games')) {
      const [
        id,
        joinCode,
        boardJson,
        currentPlayer,
        status,
        winner,
        blackScore,
        whiteScore,
        consecutivePasses,
        version,
        createdAt,
        updatedAt,
        blackDigest,
        whiteDigest,
        inviteDigest,
        whiteJoined,
        blackCreatedAt,
        inviteCreatedAt,
        inviteClaimedAt,
        whiteCreatedAt,
        rematchOfGameId,
        blackJoined,
        blackInviteDigest,
        blackInviteCreatedAt,
        blackInviteClaimedAt,
      ] = this.params;
      const code = String(joinCode);

      if (this.db.rowsByCode.has(code)) {
        throw new Error('UNIQUE constraint failed: games.join_code');
      }

      this.db.rowsByCode.set(code, {
        id,
        join_code: joinCode,
        board_json: boardJson,
        current_player: currentPlayer,
        status,
        winner,
        black_score: blackScore,
        white_score: whiteScore,
        consecutive_passes: consecutivePasses,
        version,
        created_at: createdAt,
        updated_at: updatedAt,
        black_player_token_digest: blackDigest,
        white_player_token_digest: whiteDigest,
        white_invite_token_digest: inviteDigest,
        white_joined: whiteJoined,
        black_player_created_at: blackCreatedAt,
        white_invite_created_at: inviteCreatedAt,
        white_invite_claimed_at: inviteClaimedAt,
        white_player_created_at: whiteCreatedAt,
        rematch_of_game_id: rematchOfGameId,
        black_joined: blackJoined,
        black_invite_token_digest: blackInviteDigest,
        black_invite_created_at: blackInviteCreatedAt,
        black_invite_claimed_at: blackInviteClaimedAt,
      });

      return makeD1Result(1);
    }

    if (this.sql.includes('white_player_token_digest') && this.sql.includes('white_joined = 0')) {
      const whiteDigest = this.params[0];
      const nextVersion = this.params[1];
      const joinCode = String(this.params[6]);
      const inviteDigest = this.params[7];
      const row = this.db.rowsByCode.get(joinCode);

      if (
        !row ||
        this.db.forceClaimRace ||
        row.white_joined !== 0 ||
        row.white_invite_token_digest !== inviteDigest
      ) {
        return makeD1Result(0);
      }

      this.db.rowsByCode.set(joinCode, {
        ...row,
        white_player_token_digest: whiteDigest,
        white_invite_token_digest: null,
        white_joined: 1,
        version: nextVersion,
        white_invite_claimed_at: this.params[2],
        white_player_created_at: this.params[3],
        updated_at: this.params[4],
      });

      return makeD1Result(1);
    }

    if (this.sql.includes('black_player_token_digest') && this.sql.includes('black_joined = 0')) {
      const blackDigest = this.params[0];
      const nextVersion = this.params[1];
      const joinCode = String(this.params[6]);
      const inviteDigest = this.params[7];
      const row = this.db.rowsByCode.get(joinCode);

      if (
        !row ||
        row.black_joined !== 0 ||
        row.black_invite_token_digest !== inviteDigest
      ) {
        return makeD1Result(0);
      }

      this.db.rowsByCode.set(joinCode, {
        ...row,
        black_player_token_digest: blackDigest,
        black_invite_token_digest: null,
        black_joined: 1,
        version: nextVersion,
        black_invite_claimed_at: this.params[2],
        black_player_created_at: this.params[3],
        updated_at: this.params[4],
      });

      return makeD1Result(1);
    }

    if (this.sql.includes('UPDATE games')) {
      const id = this.params[9];
      const joinCode = String(this.params[10]);
      const expectedVersion = this.params[11];
      const currentRow = this.db.rowsByCode.get(joinCode);

      if (
        !currentRow ||
        this.db.forceStaleUpdate ||
        currentRow.id !== id ||
        currentRow.version !== expectedVersion
      ) {
        return makeD1Result(0);
      }

      const [
        boardJson,
        currentPlayer,
        status,
        winner,
        blackScore,
        whiteScore,
        consecutivePasses,
        version,
        updatedAt,
      ] = this.params;

      this.db.rowsByCode.set(joinCode, {
        ...currentRow,
        board_json: boardJson,
        current_player: currentPlayer,
        status,
        winner,
        black_score: blackScore,
        white_score: whiteScore,
        consecutive_passes: consecutivePasses,
        version,
        updated_at: updatedAt,
      });

      return makeD1Result(1);
    }

    throw new Error(`Unsupported run() SQL: ${this.sql}`);
  }
}

class FakeD1Database {
  readonly rowsByCode = new Map<string, StoredRow>();
  pushSubscriptions: StoredRow[] = [];
  pushNotificationEvents: StoredRow[] = [];
  forceStaleUpdate = false;
  forceClaimRace = false;

  prepare(sql: string): D1PreparedStatement {
    return new FakeD1PreparedStatement(sql, this) as unknown as D1PreparedStatement;
  }
}

function makeD1Result(changes: number): D1Result {
  return {
    success: true,
    meta: {
      changes,
      duration: 0,
      last_row_id: 0,
      changed_db: true,
      size_after: 0,
      rows_read: 0,
      rows_written: changes,
    },
    results: [],
  };
}

function createEnv(db = new FakeD1Database()) {
  return { DB: db as unknown as D1Database };
}

function createPushEnv(db = new FakeD1Database()) {
  return {
    DB: db as unknown as D1Database,
    VAPID_PUBLIC_KEY: 'public-key',
    VAPID_PRIVATE_KEY: '{"kty":"EC","crv":"P-256","x":"x","y":"y","d":"d"}',
    VAPID_SUBJECT: 'mailto:test@example.com',
  };
}

function createExecutionContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext;
}

function auth(token?: string): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function request(path: string, init?: RequestInit): Request {
  return new Request(`${API_ORIGIN}${path}`, init);
}

async function fetchJson(
  env: ReturnType<typeof createEnv>,
  path: string,
  init?: RequestInit,
) {
  const workerRequest = request(path, init) as Parameters<typeof worker.fetch>[0];
  const response = await worker.fetch(workerRequest, env, createExecutionContext());
  const body = (await response.json()) as {
    readonly id?: string;
    readonly joinCode?: string;
    readonly version?: number;
    readonly playerColor?: string;
    readonly opponentJoined?: boolean;
    readonly playerToken?: string;
    readonly invitation?: string;
    readonly error?: string;
    readonly black_player_token_digest?: string;
    readonly state?: {
      readonly currentPlayer?: string;
      readonly status?: string;
      readonly board?: readonly (readonly unknown[])[];
    };
  };

  return { response, body };
}

function mockJoinCodes(codes: readonly string[]) {
  const values = codes.join('').split('').map((character) => {
    const index = CODE_ALPHABET.indexOf(character);
    if (index < 0) {
      throw new Error(`Invalid mocked code character: ${character}`);
    }
    return index;
  });

  let valueIndex = 0;
  let tokenByte = 1;

  return vi
    .spyOn(crypto, 'getRandomValues')
    .mockImplementation((array: ArrayBufferView | null) => {
      if (array instanceof Uint32Array) {
        for (let index = 0; index < array.length; index += 1) {
          array[index] = values[valueIndex] ?? 0;
          valueIndex += 1;
        }
        return array;
      }

      if (array instanceof Uint8Array) {
        for (let index = 0; index < array.length; index += 1) {
          array[index] = tokenByte % 255;
          tokenByte += 1;
        }
        return array;
      }

      throw new Error('Expected typed array');
    });
}

function splitInvitation(invitation: string) {
  const [joinCode, inviteToken] = invitation.split(':', 2);
  return { joinCode, inviteToken };
}

function finishGame(db: FakeD1Database, joinCode: string) {
  const row = db.rowsByCode.get(joinCode);
  if (!row) {
    throw new Error(`Missing game ${joinCode}`);
  }

  const board = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 'black'));
  db.rowsByCode.set(joinCode, {
    ...row,
    board_json: JSON.stringify(board),
    current_player: 'black',
    status: 'finished',
    winner: 'black',
    black_score: 64,
    white_score: 0,
    consecutive_passes: 0,
    updated_at: new Date().toISOString(),
  });
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function createValidPushMaterial() {
  const vapidKeys = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair;
  const privateJwk = await crypto.subtle.exportKey('jwk', vapidKeys.privateKey);
  const subscriptionKeys = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  ) as CryptoKeyPair;
  const rawPublicKey = await crypto.subtle.exportKey(
    'raw',
    subscriptionKeys.publicKey,
  ) as ArrayBuffer;

  return {
    privateJwk: JSON.stringify(privateJwk),
    p256dh: base64Url(new Uint8Array(rawPublicKey)),
    auth: base64Url(new Uint8Array(16).fill(7)),
  };
}

async function createGame(env: ReturnType<typeof createEnv>, code = 'ABCDEF') {
  mockJoinCodes([code]);
  return fetchJson(env, '/api/games', { method: 'POST' });
}

async function joinWhite(
  env: ReturnType<typeof createEnv>,
  joinCode: string,
  inviteToken: string,
) {
  return fetchJson(env, `/api/games/${joinCode}/join`, {
    method: 'POST',
    body: JSON.stringify({ inviteToken }),
  });
}

describe('authenticated game API', () => {
  let db: FakeD1Database;
  let env: ReturnType<typeof createEnv>;

  beforeEach(() => {
    vi.restoreAllMocks();
    db = new FakeD1Database();
    env = createEnv(db);
  });

  it('assigns the creator to Black and returns credentials only on creation', async () => {
    const { response, body } = await createGame(env);

    expect(response.status).toBe(201);
    expect(body.joinCode).toBe('ABCDEF');
    expect(body.playerColor).toBe('black');
    expect(body.playerToken).toBeTruthy();
    expect(body.invitation).toContain('ABCDEF:');
    expect(body.opponentJoined).toBe(false);
    expect(body.black_player_token_digest).toBeUndefined();

    const read = await fetchJson(env, '/api/games/ABCDEF', {
      headers: auth(body.playerToken),
    });

    expect(read.response.status).toBe(200);
    expect(read.body.playerToken).toBeUndefined();
    expect(read.body.invitation).toBeUndefined();
    expect(read.body.playerColor).toBe('black');
  });

  it('claims White with an invitation and returns a different private token', async () => {
    const created = await createGame(env);
    const { joinCode, inviteToken } = splitInvitation(created.body.invitation!);

    const joined = await joinWhite(env, joinCode, inviteToken);

    expect(joined.response.status).toBe(200);
    expect(joined.body.playerColor).toBe('white');
    expect(joined.body.playerToken).toBeTruthy();
    expect(joined.body.playerToken).not.toBe(created.body.playerToken);
    expect(joined.body.invitation).toBeUndefined();
    expect(joined.body.opponentJoined).toBe(true);
  });

  it('increments the resource version when White joins so Black polling sees it', async () => {
    const created = await createGame(env);
    const blackVersion = created.body.version;
    const { joinCode, inviteToken } = splitInvitation(created.body.invitation!);

    await joinWhite(env, joinCode, inviteToken);
    const blackRead = await fetchJson(env, `/api/games/${joinCode}`, {
      headers: auth(created.body.playerToken),
    });

    expect(blackVersion).toBe(1);
    expect(blackRead.response.status).toBe(200);
    expect(blackRead.body.version).toBe(blackVersion! + 1);
    expect(blackRead.body.opponentJoined).toBe(true);
  });

  it('does not allow White to be claimed twice or concurrently', async () => {
    const created = await createGame(env);
    const { joinCode, inviteToken } = splitInvitation(created.body.invitation!);

    expect((await joinWhite(env, joinCode, inviteToken)).response.status).toBe(200);
    expect((await joinWhite(env, joinCode, inviteToken)).response.status).toBe(409);

    const second = await createGame(env, 'GHJKLM');
    const secondInvite = splitInvitation(second.body.invitation!);
    db.forceClaimRace = true;
    expect(
      (await joinWhite(env, secondInvite.joinCode, secondInvite.inviteToken)).response
        .status,
    ).toBe(409);
  });

  it('rejects invalid and malformed join requests', async () => {
    await createGame(env);

    expect(
      (await fetchJson(env, '/api/games/ABCDEF/join', {
        method: 'POST',
        body: JSON.stringify({ inviteToken: 42 }),
      })).response.status,
    ).toBe(400);
    expect((await joinWhite(env, 'ABCDEF', 'wrong')).response.status).toBe(403);
    expect((await joinWhite(env, 'ZZZZZZ', 'wrong')).response.status).toBe(404);
  });

  it('requires valid player tokens for reads and rejects cross-game tokens', async () => {
    mockJoinCodes(['ABCDEF', 'GHJKLM']);
    const first = await fetchJson(env, '/api/games', { method: 'POST' });
    const second = await fetchJson(env, '/api/games', { method: 'POST' });

    expect((await fetchJson(env, '/api/games/ABCDEF')).response.status).toBe(401);
    expect(
      (await fetchJson(env, '/api/games/ABCDEF', {
        headers: auth('invalid'),
      })).response.status,
    ).toBe(401);
    expect(
      (await fetchJson(env, '/api/games/GHJKLM', {
        headers: auth(first.body.playerToken),
      })).response.status,
    ).toBe(401);
    expect(
      (await fetchJson(env, '/api/games/GHJKLM', {
        headers: auth(second.body.playerToken),
      })).response.status,
    ).toBe(200);
  });

  it('enforces join and turn ownership for moves', async () => {
    const created = await createGame(env);
    const { joinCode, inviteToken } = splitInvitation(created.body.invitation!);

    expect(
      (await fetchJson(env, '/api/games/ABCDEF/moves', {
        method: 'POST',
        headers: auth(created.body.playerToken),
        body: JSON.stringify({ row: 2, col: 3, expectedVersion: 1 }),
      })).response.status,
    ).toBe(403);

    const white = await joinWhite(env, joinCode, inviteToken);

    expect(
      (await fetchJson(env, '/api/games/ABCDEF/moves', {
        method: 'POST',
        headers: auth(white.body.playerToken),
        body: JSON.stringify({ row: 2, col: 3, expectedVersion: 1 }),
      })).response.status,
    ).toBe(403);

    const blackMove = await fetchJson(env, '/api/games/ABCDEF/moves', {
      method: 'POST',
      headers: auth(created.body.playerToken),
      body: JSON.stringify({ row: 2, col: 3, expectedVersion: 2 }),
    });

    expect(blackMove.response.status).toBe(200);
    expect(blackMove.body.version).toBe(3);
    expect(blackMove.body.state?.currentPlayer).toBe('white');

    expect(
      (await fetchJson(env, '/api/games/ABCDEF/moves', {
        method: 'POST',
        headers: auth(created.body.playerToken),
        body: JSON.stringify({ row: 2, col: 2, expectedVersion: 3 }),
      })).response.status,
    ).toBe(403);

    const whiteMove = await fetchJson(env, '/api/games/ABCDEF/moves', {
      method: 'POST',
      headers: auth(white.body.playerToken),
      body: JSON.stringify({ row: 2, col: 2, expectedVersion: 3 }),
    });

    expect(whiteMove.response.status).toBe(200);
    expect(whiteMove.body.state?.currentPlayer).toBe('black');
  });

  it('preserves malformed, illegal, stale, and atomic stale move responses', async () => {
    const created = await createGame(env);
    const { joinCode, inviteToken } = splitInvitation(created.body.invitation!);
    await joinWhite(env, joinCode, inviteToken);

    expect(
      (await fetchJson(env, '/api/games/ABCDEF/moves', {
        method: 'POST',
        headers: auth(created.body.playerToken),
        body: JSON.stringify({ row: 2, col: '3', expectedVersion: 1 }),
      })).response.status,
    ).toBe(400);
    expect(
      (await fetchJson(env, '/api/games/ABCDEF/moves', {
        method: 'POST',
        headers: auth(created.body.playerToken),
        body: JSON.stringify({ row: 0, col: 0, expectedVersion: 2 }),
      })).response.status,
    ).toBe(422);
    expect(
      (await fetchJson(env, '/api/games/ABCDEF/moves', {
        method: 'POST',
        headers: auth(created.body.playerToken),
        body: JSON.stringify({ row: 2, col: 3, expectedVersion: 99 }),
      })).response.status,
    ).toBe(409);

    db.forceStaleUpdate = true;
    expect(
      (await fetchJson(env, '/api/games/ABCDEF/moves', {
        method: 'POST',
        headers: auth(created.body.playerToken),
        body: JSON.stringify({ row: 2, col: 3, expectedVersion: 2 }),
      })).response.status,
    ).toBe(409);
  });

  it('keeps case-insensitive codes and isolated games', async () => {
    mockJoinCodes(['ABCDEF', 'GHJKLM']);
    const first = await fetchJson(env, '/api/games', { method: 'POST' });
    const second = await fetchJson(env, '/api/games', { method: 'POST' });

    expect(
      (await fetchJson(env, '/api/games/abcdef', {
        headers: auth(first.body.playerToken),
      })).response.status,
    ).toBe(200);
    expect(
      (await fetchJson(env, '/api/games/GHJKLM', {
        headers: auth(second.body.playerToken),
      })).body.id,
    ).toBe(second.body.id);
  });

  it('rejects rematches for unauthenticated, non-player, and unfinished requests', async () => {
    mockJoinCodes(['ABCDEF', 'GHJKLM']);
    const first = await fetchJson(env, '/api/games', { method: 'POST' });
    const second = await fetchJson(env, '/api/games', { method: 'POST' });

    expect(
      (await fetchJson(env, '/api/games/ABCDEF/rematch', { method: 'POST' }))
        .response.status,
    ).toBe(401);
    expect(
      (await fetchJson(env, '/api/games/ABCDEF/rematch', {
        method: 'POST',
        headers: auth(second.body.playerToken),
      })).response.status,
    ).toBe(401);
    expect(
      (await fetchJson(env, '/api/games/ABCDEF/rematch', {
        method: 'POST',
        headers: auth(first.body.playerToken),
      })).response.status,
    ).toBe(409);
  });

  it('creates an immutable linked rematch with swapped colours from White', async () => {
    mockJoinCodes(['ABCDEF', 'GHJKLM']);
    const created = await fetchJson(env, '/api/games', { method: 'POST' });
    const { joinCode, inviteToken } = splitInvitation(created.body.invitation!);
    const white = await joinWhite(env, joinCode, inviteToken);
    finishGame(db, joinCode);
    const original = { ...db.rowsByCode.get(joinCode)! };

    const rematch = await fetchJson(env, '/api/games/ABCDEF/rematch', {
      method: 'POST',
      headers: auth(white.body.playerToken),
    });

    expect(rematch.response.status).toBe(201);
    expect(rematch.body.joinCode).toBe('GHJKLM');
    expect(rematch.body.playerColor).toBe('black');
    expect(rematch.body.playerToken).toBeTruthy();
    expect(rematch.body.invitation).toContain('GHJKLM:');
    expect(rematch.body.state?.status).toBe('playing');
    expect(db.rowsByCode.get(joinCode)).toEqual(original);
    expect(db.rowsByCode.get('GHJKLM')?.rematch_of_game_id).toBe(created.body.id);
  });

  it('creates an immutable linked rematch with swapped colours from Black', async () => {
    mockJoinCodes(['ABCDEF', 'GHJKLM']);
    const created = await fetchJson(env, '/api/games', { method: 'POST' });
    const { joinCode, inviteToken } = splitInvitation(created.body.invitation!);
    await joinWhite(env, joinCode, inviteToken);
    finishGame(db, joinCode);
    const original = { ...db.rowsByCode.get(joinCode)! };

    const rematch = await fetchJson(env, '/api/games/ABCDEF/rematch', {
      method: 'POST',
      headers: auth(created.body.playerToken),
    });

    expect(rematch.response.status).toBe(201);
    expect(rematch.body.joinCode).toBe('GHJKLM');
    expect(rematch.body.playerColor).toBe('white');
    expect(rematch.body.opponentJoined).toBe(false);
    expect(rematch.body.invitation).toContain('GHJKLM:');
    expect(db.rowsByCode.get(joinCode)).toEqual(original);
    expect(db.rowsByCode.get('GHJKLM')?.rematch_of_game_id).toBe(created.body.id);
    expect(db.rowsByCode.get('GHJKLM')?.black_joined).toBe(0);
    expect(db.rowsByCode.get('GHJKLM')?.white_joined).toBe(1);
  });

  it('requires push configuration for subscription creation', async () => {
    const created = await createGame(env);

    const response = await fetchJson(env, '/api/games/ABCDEF/push-subscriptions', {
      method: 'POST',
      headers: auth(created.body.playerToken),
      body: JSON.stringify({
        endpoint: 'https://push.example/subscription',
        keys: { p256dh: 'p256dh', auth: 'auth' },
      }),
    });

    expect(response.response.status).toBe(503);
  });

  it('validates and authenticates push subscriptions by game player', async () => {
    const pushEnv = createPushEnv(db);
    const created = await createGame(pushEnv);

    expect(
      (await fetchJson(pushEnv, '/api/games/ABCDEF/push-subscriptions', {
        method: 'POST',
        headers: auth(created.body.playerToken),
        body: JSON.stringify({
          endpoint: 'http://push.example/subscription',
          keys: { p256dh: 'p256dh', auth: 'auth' },
        }),
      })).response.status,
    ).toBe(400);

    expect(
      (await fetchJson(pushEnv, '/api/games/ABCDEF/push-subscriptions', {
        method: 'POST',
        headers: auth('wrong'),
        body: JSON.stringify({
          endpoint: 'https://push.example/subscription',
          keys: { p256dh: 'p256dh', auth: 'auth' },
        }),
      })).response.status,
    ).toBe(401);

    const subscribed = await fetchJson(pushEnv, '/api/games/ABCDEF/push-subscriptions', {
      method: 'POST',
      headers: auth(created.body.playerToken),
      body: JSON.stringify({
        endpoint: 'https://push.example/subscription',
        keys: { p256dh: 'p256dh', auth: 'auth' },
      }),
    });

    expect(subscribed.response.status).toBe(200);
    expect(db.pushSubscriptions).toHaveLength(1);
    expect(db.pushSubscriptions[0].game_id).toBe(created.body.id);
    expect(db.pushSubscriptions[0].player_color).toBe('black');
  });

  it('allows the same push endpoint to be associated with multiple games', async () => {
    const pushEnv = createPushEnv(db);
    mockJoinCodes(['ABCDEF', 'GHJKLM']);
    const first = await fetchJson(pushEnv, '/api/games', { method: 'POST' });
    const second = await fetchJson(pushEnv, '/api/games', { method: 'POST' });
    const subscription = {
      endpoint: 'https://push.example/shared',
      keys: { p256dh: 'p256dh', auth: 'auth' },
    };

    expect(
      (await fetchJson(pushEnv, '/api/games/ABCDEF/push-subscriptions', {
        method: 'POST',
        headers: auth(first.body.playerToken),
        body: JSON.stringify(subscription),
      })).response.status,
    ).toBe(200);
    expect(
      (await fetchJson(pushEnv, '/api/games/GHJKLM/push-subscriptions', {
        method: 'POST',
        headers: auth(second.body.playerToken),
        body: JSON.stringify(subscription),
      })).response.status,
    ).toBe(200);

    expect(db.pushSubscriptions).toHaveLength(2);
  });

  it('derives notification events without targeting the actor', async () => {
    await createGame(env);
    const game = Array.from(db.rowsByCode.values())[0]!;
    const previousGame = {
      id: String(game.id),
      joinCode: String(game.join_code),
      state: createInitialGameState(),
      version: 1,
      winner: null,
      blackScore: 2,
      whiteScore: 2,
      createdAt: String(game.created_at),
      updatedAt: String(game.updated_at),
      blackPlayerTokenDigest: String(game.black_player_token_digest),
      whitePlayerTokenDigest: null,
      whiteInviteTokenDigest: String(game.white_invite_token_digest),
      whiteJoined: false,
      rematchOfGameId: null,
      blackJoined: true,
      blackInviteTokenDigest: '',
    };
    const updatedGame = { ...previousGame, version: 2, whiteJoined: true };

    const notification = deriveNotificationEvent({
      previousGame,
      updatedGame,
      actorPlayerColor: 'white',
      eventType: 'join',
    });

    expect(notification?.eventType).toBe('white_joined');
    expect(notification?.recipientPlayerColor).toBe('black');
  });

  it('removes permanently stale subscriptions and records failed delivery state', async () => {
    const pushMaterial = await createValidPushMaterial();
    const pushEnv = {
      ...createPushEnv(db),
      VAPID_PRIVATE_KEY: pushMaterial.privateJwk,
    };
    const game = {
      id: 'game-1',
      joinCode: 'ABCDEF',
      state: createInitialGameState(),
      version: 2,
      winner: null,
      blackScore: 2,
      whiteScore: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      blackPlayerTokenDigest: 'black',
      whitePlayerTokenDigest: 'white',
      whiteInviteTokenDigest: '',
      whiteJoined: true,
      rematchOfGameId: null,
      blackJoined: true,
      blackInviteTokenDigest: '',
    };
    db.pushSubscriptions.push({
      id: 'sub-1',
      game_id: game.id,
      player_color: 'black',
      endpoint: 'https://push.example/stale',
      p256dh: pushMaterial.p256dh,
      auth: pushMaterial.auth,
      created_at: game.createdAt,
      updated_at: game.updatedAt,
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 410 }));

    await sendNotificationEvent(db as unknown as D1Database, pushEnv, game, {
      eventType: 'white_joined',
      recipientPlayerColor: 'black',
      title: 'White joined',
      body: 'Ready',
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(db.pushSubscriptions).toHaveLength(0);
    expect(db.pushNotificationEvents[0].delivery_state).toBe('failed');
    expect(db.pushNotificationEvents[0].attempts).toBe(1);
  });

  it('suppresses already sent duplicate notification events', async () => {
    const pushEnv = createPushEnv(db);
    const game = {
      id: 'game-1',
      joinCode: 'ABCDEF',
      state: createInitialGameState(),
      version: 2,
      winner: null,
      blackScore: 2,
      whiteScore: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      blackPlayerTokenDigest: 'black',
      whitePlayerTokenDigest: 'white',
      whiteInviteTokenDigest: '',
      whiteJoined: true,
      rematchOfGameId: null,
      blackJoined: true,
      blackInviteTokenDigest: '',
    };
    db.pushNotificationEvents.push({
      id: 'event-1',
      game_id: game.id,
      game_version: game.version,
      event_type: 'white_joined',
      recipient_player_color: 'black',
      delivery_state: 'sent',
      attempts: 1,
      last_error: null,
      created_at: game.createdAt,
      updated_at: game.updatedAt,
    });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await sendNotificationEvent(db as unknown as D1Database, pushEnv, game, {
      eventType: 'white_joined',
      recipientPlayerColor: 'black',
      title: 'White joined',
      body: 'Ready',
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(db.pushNotificationEvents).toHaveLength(1);
  });
});
