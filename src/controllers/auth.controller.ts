import { Request, Response, NextFunction } from "express";
import { AuthService } from "../services/auth.service";
import { PasswordResetService } from "../services/password-reset.service";
import { success, created } from "../utils/response";
import { BadRequestError } from "../utils/errors";
import { AuthenticatedRequest } from "../middleware/auth.middleware";
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
