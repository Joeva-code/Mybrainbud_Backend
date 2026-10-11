import { config } from "dotenv";
import { join } from "path";

// Load environment variables based on NODE_ENV
const envFile = process.env.NODE_ENV === "test" ? ".env.test" : ".env";
config({ path: join(process.cwd(), envFile) });

const isTestEnv = process.env.NODE_ENV === "test";

// In test mode, fall back to safe dummy values so the automated test suite can
// run without a reachable database or real secrets. These are never valid
// credentials and are only applied when NODE_ENV === "test".
const testDefaults: Record<string, string> = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  JWT_ACCESS_SECRET: "test-access-secret-must-be-at-least-32-chars-long",
  JWT_REFRESH_SECRET: "test-refresh-secret-must-be-at-least-32-chars-long",
  PORT: "5000",
};

// Validate required environment variables
const requiredEnvVars = [
  "DATABASE_URL",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "PORT",
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    const fallback = isTestEnv ? testDefaults[envVar] : undefined;
    if (fallback) {
      process.env[envVar] = fallback;
    } else {
      throw new Error(`Missing required environment variable: ${envVar}`);
    }
  }
}

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT || "5000", 10),
  databaseUrl: process.env.DATABASE_URL!,
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET!,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET!,
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  redisUrl: process.env.REDIS_URL,
  neo4jUri: process.env.NEO4J_URI,
  neo4jUsername: process.env.NEO4J_USERNAME,
  neo4jPassword: process.env.NEO4J_PASSWORD,
  openaiApiKey: process.env.OPENAI_API_KEY,
  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY,
  flutterwaveSecretKey: process.env.FLUTTERWAVE_SECRET_KEY,

  // CORS (must be set to the exact frontend origin for credentialed requests/cookies)
  corsOrigin: process.env.CORS_ORIGIN,

  // Google Sign-In (Google Identity Services ID token verification)
  googleClientId: process.env.GOOGLE_CLIENT_ID,

  // Google OAuth 2.0 redirect flow (authorization-code grant)
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL,

  // Frontend origin for OAuth browser redirects (falls back to CORS_ORIGIN,
  // then to a local dev origin). Overridable landing pages below take priority.
  frontendUrl: process.env.FRONTEND_URL || process.env.CORS_ORIGIN,
  googleOAuthSuccessRedirect: process.env.GOOGLE_OAUTH_SUCCESS_REDIRECT,
  googleOAuthFailureRedirect: process.env.GOOGLE_OAUTH_FAILURE_REDIRECT,

  // Outbound message delivery ("gmail" | "console" | "none")
  emailDeliveryProvider: (process.env.EMAIL_DELIVERY_PROVIDER || "console").toLowerCase(),

  // Gmail SMTP (https://support.google.com/accounts/answer/185833)
  // SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM
  smtpHost: process.env.SMTP_HOST,
  smtpPort: intFromEnv("SMTP_PORT", 587),
  smtpUser: process.env.SMTP_USER,
  smtpPass: process.env.SMTP_PASS,
  emailFrom: process.env.EMAIL_FROM,

  // OTP verification policy (a 4-digit code is fixed by the product design)
  otpExpiryMinutes: intFromEnv("OTP_EXPIRY_MINUTES", 10),
  otpResendCooldownSeconds: intFromEnv("OTP_RESEND_COOLDOWN_SECONDS", 60),
  otpMaxAttempts: intFromEnv("OTP_MAX_ATTEMPTS", 5),
  otpMaxResendsPerHour: intFromEnv("OTP_MAX_RESENDS_PER_HOUR", 5),

  // Password reset policy
  resetTokenExpiryMinutes: intFromEnv("RESET_TOKEN_EXPIRY_MINUTES", 30),
  resetTokenMaxAttempts: intFromEnv("RESET_TOKEN_MAX_ATTEMPTS", 5),
};