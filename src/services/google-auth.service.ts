import { OAuth2Client } from "google-auth-library";
import { env } from "../config/env";
import { ServiceUnavailableError, UnauthorizedError } from "../utils/errors";

/**
 * Google Identity Services ID-token verification.
 *
 * Only ID tokens are accepted (never access tokens). google-auth-library
 * validates the signature against Google's certificates, the issuer, the
 * audience (GOOGLE_CLIENT_ID), and the expiry before we inspect any claims.
 * The `email_verified` claim must be true — a client-supplied email is never
 * trusted on its own.
 */

export interface GoogleVerifiedProfile {
  sub: string;
  email: string;
  firstName: string;
  lastName?: string;
}

interface GoogleIdPayload {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
}

/**
 * Extracts a verified profile from a validated token payload.
 * Exported separately so the claim checks are unit-testable without Google.
 */
export function pickGoogleProfile(payload: GoogleIdPayload | undefined): GoogleVerifiedProfile {
  if (!payload || !payload.email || payload.email_verified !== true) {
    throw new UnauthorizedError("Unable to verify Google account credentials");
  }

  const email = payload.email.trim().toLowerCase();
  const nameParts = (payload.name ?? "").trim().split(/\s+/).filter(Boolean);
  const firstName = payload.given_name || nameParts[0] || "User";
  const lastName =
    payload.family_name || (nameParts.length > 1 ? nameParts.slice(1).join(" ") : undefined);

  return {
    sub: payload.sub ?? "",
    email,
    firstName,
    lastName,
  };
}

/** Verifies a Google ID token and returns the verified profile claims. */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleVerifiedProfile> {
  if (!env.googleClientId) {
    throw new ServiceUnavailableError("Google sign-in is not configured.");
  }

  const client = new OAuth2Client({ clientId: env.googleClientId });

  let payload: GoogleIdPayload | undefined;
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: env.googleClientId,
    });
    payload = ticket.getPayload();
  } catch {
    // Signature, audience, issuer, and expiry failures are all reported as
    // the same generic client-safe error.
    throw new UnauthorizedError("Invalid Google credentials");
  }

  return pickGoogleProfile(payload);
}

/**
 * Google OAuth 2.0 redirect (authorization-code) flow.
 *
 * Unlike the ID-token flow above, this is the classic "Sign in with Google"
 * redirect: the browser is sent to Google's consent screen, Google redirects
 * back to GOOGLE_CALLBACK_URL with a one-time `code`, and the server exchanges
 * that code for tokens. The returned ID token is then verified exactly like
 * `verifyGoogleIdToken`, so both flows share the same claim checks.
 */

/** Scopes requested during the authorization-code flow. */
export const GOOGLE_OAUTH_SCOPES = ["openid", "email", "profile"];

/** Lazily builds an OAuth2Client configured for the redirect flow. */
export function createGoogleOAuthClient(): OAuth2Client {
  if (!env.googleClientId || !env.googleClientSecret || !env.googleCallbackUrl) {
    throw new ServiceUnavailableError("Google OAuth is not configured.");
  }
  return new OAuth2Client({
    clientId: env.googleClientId,
    clientSecret: env.googleClientSecret,
    redirectUri: env.googleCallbackUrl,
  });
}

/** Builds the Google consent-screen URL to redirect the browser to. */
export function getGoogleAuthorizationUrl(state: string): string {
  const client = createGoogleOAuthClient();
  return client.generateAuthUrl({
    access_type: "online",
    scope: GOOGLE_OAUTH_SCOPES,
    state,
    // Always show the account chooser so users can switch accounts.
    prompt: "select_account",
  });
}

/**
 * Exchanges an authorization code for tokens and returns the verified profile.
 * The ID token is validated for signature, audience, issuer, and expiry; only
 * verified-email payloads are accepted (via pickGoogleProfile).
 */
export async function exchangeGoogleCodeForProfile(
  code: string
): Promise<GoogleVerifiedProfile> {
  const client = createGoogleOAuthClient();

  let idToken: string | undefined;
  try {
    const { tokens } = await client.getToken(code);
    idToken = tokens.id_token ?? undefined;
  } catch {
    throw new UnauthorizedError("Invalid Google authorization code");
  }

  if (!idToken) {
    throw new UnauthorizedError("Invalid Google credentials");
  }

  let payload: GoogleIdPayload | undefined;
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: env.googleClientId,
    });
    payload = ticket.getPayload();
  } catch {
    throw new UnauthorizedError("Invalid Google credentials");
  }

  return pickGoogleProfile(payload);
}
