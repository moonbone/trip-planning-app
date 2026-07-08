// Google sign-in verification + stateless signed-cookie sessions.
// No npm dependencies: Google ID tokens are verified with node:crypto
// against Google's published JWKS; sessions are HMAC-signed blobs.

import { createHmac, createPublicKey, verify as cryptoVerify, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'session';
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

// ---- sessions ----

export function createSessionToken(user, secret) {
  const payload = Buffer.from(JSON.stringify({
    sub: user.sub,
    email: user.email,
    name: user.name,
    exp: Date.now() + SESSION_TTL_MS,
  })).toString('base64url');
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function readSessionToken(token, secret) {
  if (!token || !secret) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.exp || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

// Secure is fine for local dev too: browsers treat localhost as trustworthy.
export function sessionSetCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}`;
}
export function sessionClearCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// Reads the session cookie from a Lambda Function URL event (cookies array)
// or a dev-server event (headers.cookie string).
export function sessionFromEvent(event, secret) {
  const cookieStrs = event.cookies
    || (event.headers?.cookie ? event.headers.cookie.split(';') : []);
  for (const c of cookieStrs) {
    const [k, ...rest] = c.trim().split('=');
    if (k === SESSION_COOKIE) return readSessionToken(rest.join('='), secret);
  }
  return null;
}

// ---- Google ID token verification ----

let jwksCache = { keys: null, fetchedAt: 0 };

async function googleJwks() {
  if (jwksCache.keys && Date.now() - jwksCache.fetchedAt < 3600 * 1000) {
    return jwksCache.keys;
  }
  const res = await fetch(GOOGLE_JWKS_URL);
  if (!res.ok) throw new Error('could not fetch Google keys');
  const { keys } = await res.json();
  jwksCache = { keys, fetchedAt: Date.now() };
  return keys;
}

// Returns {sub, email, name} for a valid credential, throws otherwise.
// AUTH_DEV_FAKE=1 additionally accepts "dev:<email>[:<name>]" pseudo-tokens
// so the whole login flow is testable before a GCP OAuth client exists.
// deploy.sh never sets AUTH_DEV_FAKE, so this cannot be on in production.
export async function verifyGoogleCredential(credential, clientId) {
  if (process.env.AUTH_DEV_FAKE === '1' && credential.startsWith('dev:')) {
    const [, email, name] = credential.split(':');
    if (!email || !email.includes('@')) throw new Error('dev token needs an email');
    return { sub: 'dev-' + email, email, name: name || email.split('@')[0] };
  }
  if (!clientId) throw new Error('Google sign-in is not configured on this server');

  const [h, p, s] = credential.split('.');
  if (!h || !p || !s) throw new Error('malformed credential');
  const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
  const payload = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));

  const jwk = (await googleJwks()).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('unknown signing key');
  const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
  const ok = cryptoVerify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, 'base64url'));
  if (!ok) throw new Error('invalid signature');

  if (payload.aud !== clientId) throw new Error('wrong audience');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(payload.iss)) {
    throw new Error('wrong issuer');
  }
  if (payload.exp * 1000 < Date.now()) throw new Error('credential expired');
  if (!payload.email) throw new Error('credential has no email');

  return { sub: payload.sub, email: payload.email, name: payload.name || payload.email };
}

export function isAdminEmail(email) {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes((email || '').toLowerCase());
}
