const JOIN_CODE_LENGTH = 6;

function normalizeJoinCode(code: string): string {
  return code.trim().toUpperCase();
}

export function parseInvitation(value: string): { readonly joinCode: string; readonly inviteToken: string } | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(':');
  if (parts.length !== 2) {
    return null;
  }

  const [code, token] = parts;
  const joinCode = normalizeJoinCode(code);
  if (joinCode.length !== JOIN_CODE_LENGTH || !token) {
    return null;
  }

  return { joinCode, inviteToken: token };
}
