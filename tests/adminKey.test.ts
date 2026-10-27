import { randomBytes, scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { adminKeyMatches } from '../server/lobby';

/** The line `npm run admin:key` writes (scripts/admin-key.mjs), at a cheaper N for the test. */
function hashed(key: string, N = 1 << 12): string {
  const salt = randomBytes(16);
  const hash = scryptSync(key.normalize('NFC'), salt, 32, { N, r: 8, p: 1, maxmem: 256 * N * 8 });
  return `scrypt$${N}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

describe('admin key', () => {
  it('checks a passphrase against its scrypt hash', () => {
    const real = hashed('갈매기 등대 아침 바다');
    expect(adminKeyMatches('갈매기 등대 아침 바다', real)).toBe(true);
    expect(adminKeyMatches('갈매기 등대 아침 바다 ', real)).toBe(false);
    expect(adminKeyMatches('', real)).toBe(false);
    // The hash itself is not the key.
    expect(adminKeyMatches(real, real)).toBe(false);
  });

  it('refuses a malformed hash line and still takes a plain key', () => {
    expect(adminKeyMatches('x', 'scrypt$7$abc$def')).toBe(false);
    expect(adminKeyMatches('the-admin-key-123', 'the-admin-key-123')).toBe(true);
    expect(adminKeyMatches('the-admin-key-124', 'the-admin-key-123')).toBe(false);
  });
});
