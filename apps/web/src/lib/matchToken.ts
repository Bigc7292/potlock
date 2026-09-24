import { SignJWT } from "jose";

/** Short-lived pass that lets the match server trust who is joining. Same format services/match verifies. */
export async function signMatchToken(userId: string, name: string): Promise<string> {
  const secret = process.env.MATCH_TOKEN_SECRET;
  if (!secret || secret.length < 16) throw new Error("MATCH_TOKEN_SECRET must be set (16+ characters)");
  return new SignJWT({ name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer("potlock-web")
    .setAudience("potlock-match")
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(secret));
}
