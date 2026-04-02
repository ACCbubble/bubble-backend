// In-memory JWT revocation list.
// Entries self-expire — no background cleanup needed.
// In production, replace with Redis (SETEX jti TTL "1").
const revoked = new Map<string, number>() // jti -> expiry unix ms

export function revokeJti(jti: string, expiresAtMs: number): void {
  revoked.set(jti, expiresAtMs)
}

export function isRevoked(jti: string): boolean {
  const exp = revoked.get(jti)
  if (exp === undefined) return false
  if (Date.now() > exp) {
    revoked.delete(jti) // lazy cleanup
    return false
  }
  return true
}
