import { Request, Response, NextFunction } from "express";
import { AuthService } from "../services/auth.service";
import { success, created } from "../utils/response";
import { RegisterDto, LoginDto } from "../types/auth.types";

export const register = (service: AuthService) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto: RegisterDto = req.body;
    const result = await service.register(dto);
    return created(res, "Registration successful", result);
  } catch (error) {
    next(error);
  }
};

export const login = (service: AuthService) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dto: LoginDto = req.body;
    const result = await service.login(dto);

    res.cookie("refreshToken", result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: service.getRefreshTokenMaxAgeMs(),
      path: "/",
    });

    return success(res, "Login successful", result);
  } catch (error) {
    next(error);
  }
};

export const refreshToken = (service: AuthService) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refreshToken } = req.body;
    const result = await service.refreshToken(refreshToken);
    return success(res, "Token refreshed", result);
  } catch (error) {
    next(error);
  }
};

export const logout = (service: AuthService) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as any;
    await service.logout(authReq.sessionId, authReq.userId);
    res.clearCookie("refreshToken", { path: "/" });
    return success(res, "Logout successful");
  } catch (error) {
    next(error);
  }
};

export const logoutAll = (service: AuthService) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as any;
    await service.logoutAll(authReq.userId);
    res.clearCookie("refreshToken", { path: "/" });
    return success(res, "All sessions logged out successfully");
  } catch (error) {
    next(error);
  }
};

export const getMe = () => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
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
