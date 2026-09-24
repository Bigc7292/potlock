import { SignJWT, jwtVerify } from "jose";
import type { MatchTokenClaims } from "@potlock/shared";

const ISSUER = "potlock-web";
const AUDIENCE = "potlock-match";

function key(secret: string): Uint8Array {
  if (secret.length < 16) throw new Error("MATCH_TOKEN_SECRET must be at least 16 characters");
  return new TextEncoder().encode(secret);
}

/** Verify a match token minted by apps/web. Returns null if it is missing, forged or expired. */
export async function verifyMatchToken(token: unknown, secret: string): Promise<MatchTokenClaims | null> {
  if (typeof token !== "string" || token.length === 0 || token.length > 4096) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), { issuer: ISSUER, audience: AUDIENCE });
    if (typeof payload.sub !== "string" || typeof payload.name !== "string") return null;
    return { sub: payload.sub, name: payload.name };
  } catch {
    return null;
  }
}

/** Same format apps/web uses; exported for tests and load scripts. */
export async function signMatchToken(claims: MatchTokenClaims, secret: string, ttlSeconds = 600): Promise<string> {
  return new SignJWT({ name: claims.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key(secret));
}
