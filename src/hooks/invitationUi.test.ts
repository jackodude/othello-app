import { describe, expect, it } from 'vitest';

import { INVITATION_COPY_LABEL } from './invitationUi';

describe('invitation UI copy', () => {
  it('uses a single full-invitation copy action', () => {
    expect(INVITATION_COPY_LABEL).toBe('Copy invitation');
  });
});
