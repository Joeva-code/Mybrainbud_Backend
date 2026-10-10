import { Request, Response, NextFunction } from "express";
import { AuthService } from "../services/auth.service";
import { PasswordResetService } from "../services/password-reset.service";
import {
  getGoogleAuthorizationUrl,
} from "../services/google-auth.service";
import { success, created } from "../utils/response";
import { BadRequestError, UnauthorizedError } from "../utils/errors";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
import { env } from "../config/env";
import { randomBytes } from "node:crypto";
import {
  RegisterDto,
  LoginDto,
  VerifyOtpDto,
  ResendOtpDto,
  GoogleAuthDto,
  ForgotPasswordDto,
  ResetPasswordDto,
} from "../types/auth.types";

const isProduction = process.env.NODE_ENV === "production";

/** Name of the short-lived cookie that carries the OAuth CSRF `state`. */
const GOOGLE_OAUTH_STATE_COOKIE = "google_oauth_state";
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

/** Shared attributes for the refresh-token cookie (HttpOnly + Strict + Secure in prod). */
function refreshCookieOptions(maxAgeMs?: number): Record<string, unknown> {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict" as const,
    path: "/",
    ...(maxAgeMs !== undefined ? { maxAge: maxAgeMs } : {}),
  };
}

function setRefreshCookie(res: Response, token: string, service: AuthService): void {
  res.cookie("refreshToken", token, refreshCookieOptions(service.getRefreshTokenMaxAgeMs()));
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie("refreshToken", refreshCookieOptions());
}

export const register =
  (service: AuthService) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto: RegisterDto = req.body;
      const result = await service.register(dto);
      // 201: the account is created but NOT yet verified — no session or
      // tokens are issued until POST /api/auth/verify-otp succeeds.
      return created(
        res,
        "Registration successful. Please check your email for the verification code.",
        result
      );
    } catch (error) {
      next(error);
    }
  };

export const login =
  (service: AuthService) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto: LoginDto = req.body;
      const result = await service.login(dto);

      setRefreshCookie(res, result.refreshToken, service);

      return success(res, "Login successful", result);
    } catch (error) {
      next(error);
    }
  };

export const verifyOtp =
  (service: AuthService) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto: VerifyOtpDto = req.body;
      const result = await service.verifyOtp(dto);

      setRefreshCookie(res, result.refreshToken, service);

      return success(res, "Verification successful", result);
    } catch (error) {
      next(error);
    }
  };

export const resendOtp =
  (service: AuthService) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto: ResendOtpDto = req.body;
      const result = await service.resendOtp(dto);
      // Generic response — never reveals whether the account exists.
      return success(
        res,
        "If an account with that email exists, a verification code has been sent.",
        { cooldownSeconds: result.cooldownSeconds }
      );
    } catch (error) {
      next(error);
    }
  };

export const googleAuth =
  (service: AuthService) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto: GoogleAuthDto = req.body;
      const result = await service.googleAuth(dto);

      setRefreshCookie(res, result.refreshToken, service);

      return success(res, "Google sign-in successful", result);
    } catch (error) {
      next(error);
    }
  };

/**
 * Base origin used for post-OAuth browser redirects. Prefers an explicit
 * FRONTEND_URL / CORS_ORIGIN, falling back to the local dev origin so the flow
 * still works out of the box.
 */
function frontendOrigin(): string {
  return (env.frontendUrl || "http://localhost:3000").replace(/\/+$/, "");
}

/** Resolves the success landing page (explicit override, or the SPA callback). */
function googleSuccessRedirect(): string {
  return env.googleOAuthSuccessRedirect || `${frontendOrigin()}/auth/callback`;
}

/** Resolves the failure landing page, appending a generic `error` flag. */
function googleFailureRedirect(): string {
  return env.googleOAuthFailureRedirect || `${frontendOrigin()}/login?error=google`;
}

/**
 * GET /api/auth/google — begins the Google OAuth 2.0 redirect flow.
 * Mints a random CSRF `state`, stores it in a short-lived HttpOnly cookie,
 * and 302-redirects the browser to Google's consent screen.
 */
export const googleOAuthInitiate =
  () => async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const state = randomBytes(32).toString("hex");
      res.cookie(GOOGLE_OAUTH_STATE_COOKIE, state, {
        httpOnly: true,
        secure: isProduction,
        sameSite: "lax", // must survive the top-level redirect back from Google
        path: "/",
        maxAge: OAUTH_STATE_MAX_AGE_MS,
      });

      const url = getGoogleAuthorizationUrl(state);
      return res.redirect(url);
    } catch (error) {
      next(error);
    }
  };

/**
 * GET /api/auth/google/callback — Google redirects here with a one-time `code`
 * and the `state` we issued. We verify `state` (CSRF), exchange the code for a
 * verified profile, create a session, set the refresh cookie, and redirect the
 * browser to the frontend with the access token in the URL.
 */
export const googleOAuthCallback =
  (service: AuthService) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
      const expectedState = cookies?.[GOOGLE_OAUTH_STATE_COOKIE];
      const state = typeof req.query.state === "string" ? req.query.state : undefined;

      // Clear the state cookie regardless of outcome (single-use).
      res.clearCookie(GOOGLE_OAUTH_STATE_COOKIE, {
        httpOnly: true,
        secure: isProduction,
        sameSite: "lax",
        path: "/",
      });

      // User denied consent on Google's screen.
      if (typeof req.query.error === "string") {
        return res.redirect(googleFailureRedirect());
      }

      if (!state || !expectedState || state !== expectedState) {
        throw new UnauthorizedError("Invalid OAuth state");
      }

      const code = typeof req.query.code === "string" ? req.query.code : undefined;
      if (!code) {
        throw new BadRequestError("Missing authorization code");
      }

      const result = await service.googleOAuth(code);
      setRefreshCookie(res, result.refreshToken, service);

      // Hand the SPA the short-lived access token; the refresh token stays in
      // the HttpOnly cookie set above.
      const redirectUrl = new URL(googleSuccessRedirect());
      redirectUrl.searchParams.set("accessToken", result.accessToken);
      redirectUrl.searchParams.set("expiresIn", String(result.expiresIn));
      return res.redirect(redirectUrl.toString());
    } catch (error) {
      // Redirect-based flows can't surface JSON errors to the user cleanly, so
      // send the browser back to the frontend failure page instead.
      return res.redirect(googleFailureRedirect());
    }
  };


export const refreshToken =
  (service: AuthService) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
      const token = req.body?.refreshToken ?? cookies?.refreshToken;
      if (!token) {
        throw new BadRequestError("Refresh token is required");
      }
      const result = await service.refreshToken(token);
      // Rotate the cookie along with the token so cookie-based clients keep
      // working after every refresh.
      setRefreshCookie(res, result.refreshToken, service);
      return success(res, "Token refreshed", result);
    } catch (error) {
      next(error);
    }
  };

export const logout =
  (service: AuthService) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authReq = req as AuthenticatedRequest;
      await service.logout(authReq.sessionId, authReq.userId);
      clearRefreshCookie(res);
      return success(res, "Logout successful");
    } catch (error) {
      next(error);
    }
  };

export const logoutAll =
  (service: AuthService) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authReq = req as AuthenticatedRequest;
      await service.logoutAll(authReq.userId);
      clearRefreshCookie(res);
      return success(res, "All sessions logged out successfully");
    } catch (error) {
      next(error);
    }
  };

export const getMe = () => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const user = authReq.user;
    // Never expose password hashes, tokens, or provider internals.
    const safeUser = {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      isVerified: user.isVerified,
      isActive: user.isActive,
    };
    return success(res, "User retrieved", safeUser);
  } catch (error) {
    next(error);
  }
};

export const forgotPassword =
  (service: PasswordResetService) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto: ForgotPasswordDto = req.body;
      await service.requestReset(dto.email);
      // Identical response whether or not the account exists.
      return success(
        res,
        "If an account with that email exists, a password reset link has been sent."
      );
    } catch (error) {
      next(error);
    }
  };

export const resetPassword =
  (service: PasswordResetService) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const dto: ResetPasswordDto = req.body;
      await service.resetPassword(dto);
      return success(res, "Password has been reset successfully. Please sign in with your new password.");
    } catch (error) {
      next(error);
    }
  };
