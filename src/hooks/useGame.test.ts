import { describe, expect, it } from 'vitest';

import { parseInvitation } from './invitation';

describe('parseInvitation', () => {
  it('parses a combined invitation', () => {
    expect(parseInvitation('abcdef:invite-token')).toEqual({
      joinCode: 'ABCDEF',
      inviteToken: 'invite-token',
    });
  });

  it('rejects malformed combined invitations', () => {
    expect(parseInvitation('ABCDEF')).toBeNull();
    expect(parseInvitation('ABCDEF:')).toBeNull();
    expect(parseInvitation(':token')).toBeNull();
    expect(parseInvitation('ABCDEF:token:extra')).toBeNull();
  });
});
