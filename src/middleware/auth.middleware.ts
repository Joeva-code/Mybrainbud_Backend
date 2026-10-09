import { Request, Response, NextFunction } from "express";
import { UnauthorizedError, ForbiddenError } from "../utils/errors";
import prisma from "../lib/prisma";
import { env } from "../config/env";
import jwt, { JsonWebTokenError, TokenExpiredError } from "jsonwebtoken";

export interface AuthenticatedRequest extends Request {
  user: any;
  sessionId: string;
  userId: string;
}

export function authenticate() {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const authReq = req as AuthenticatedRequest;

      // Get token from Authorization header
      let token = authReq.headers.authorization;

      if (token && token.startsWith("Bearer ")) {
        token = token.substring(7); // Remove "Bearer " prefix
      }

      if (!token) {
        throw new UnauthorizedError("Authentication required. Please login.");
      }

      // Verify JWT token
      let decoded: any;
      try {
        decoded = jwt.verify(token, env.jwtAccessSecret);
      } catch (error) {
        if (error instanceof TokenExpiredError) {
          throw new UnauthorizedError("Access token has expired. Please refresh your session.");
        }
        if (error instanceof JsonWebTokenError) {
          throw new UnauthorizedError("Invalid access token");
        }
        throw error;
      }

      if (!decoded || !decoded.sessionId || !decoded.userId) {
        throw new UnauthorizedError("Invalid token payload");
      }

      // Verify session exists, is not revoked, and is not expired
      const session = await prisma.session.findUnique({
        where: { id: decoded.sessionId },
        include: { user: true },
      });

      if (!session) {
        throw new UnauthorizedError("Session not found. Please login.");
      }

      if (session.revokedAt) {
        throw new UnauthorizedError("Session has been revoked. Please login.");
      }

      if (new Date() > session.expiresAt) {
        throw new UnauthorizedError("Session has expired. Please login.");
      }

      const user = session.user;

      if (!user || !user.isActive) {
        throw new UnauthorizedError("Account is inactive. Please contact support.");
      }

      // Unverified contacts must complete OTP verification before they can
      // access any protected application resource.
      if (!user.isVerified) {
        throw new ForbiddenError(
          "Account not verified. Please verify your email before accessing this resource."
        );
      }

      // Attach user and session to request
      authReq.user = user;
      authReq.userId = user.id;
      authReq.sessionId = decoded.sessionId;

      next();
    } catch (error) {
      next(error);
    }
  };
}

export default authenticate;