import { beforeEach, describe, expect, it, vi } from 'vitest';

import worker from './index';

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
    if (!this.sql.includes('SELECT')) {
      throw new Error(`Unsupported first() SQL: ${this.sql}`);
    }

    const code = String(this.params[0]).toUpperCase();
    const row = this.db.rowsByCode.get(code);

    return row ? ({ ...row } as T) : null;
  }

  async run(): Promise<D1Result> {
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
  const response = await worker.fetch(workerRequest, env);
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
});
