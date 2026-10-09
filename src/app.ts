import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import routes from "./routes";
import { errorHandler } from "./middleware/error.middleware";
import { setupSwagger } from "./config/swagger";

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan("dev"));

// Rate limiting for authentication endpoints.
// A separate limiter instance is created per endpoint so each route gets its
// own budget (5 requests / 15 minutes / IP), matching the API documentation.
const createAuthRateLimiter = () =>
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // limit each IP to 5 requests per windowMs for auth endpoints
    message: {
      success: false,
      message: "Too many authentication attempts, please try again later.",
    },
    standardHeaders: true,
    legacyHeaders: false,
  });

// Slightly higher ceiling for OTP verification and Google sign-in: a 4-digit
// code allows a handful of retries, and per-code attempt limits are enforced
// independently in the service layer.
const otpVerifyRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: {
    success: false,
    message: "Too many verification attempts, please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiter to auth routes
app.use("/api/auth/login", createAuthRateLimiter());
app.use("/api/auth/register", createAuthRateLimiter());
app.use("/api/auth/refresh", createAuthRateLimiter());
app.use("/api/auth/resend-otp", createAuthRateLimiter());
app.use("/api/auth/forgot-password", createAuthRateLimiter());
app.use("/api/auth/reset-password", createAuthRateLimiter());
app.use("/api/auth/verify-otp", otpVerifyRateLimiter);
app.use("/api/auth/google", otpVerifyRateLimiter);

// API routes
app.use("/api", routes);

// Health check (keep existing endpoint)
app.get("/health", (_req, res) => {
  res.status(200).json({
    success: true,
    service: "mybrainbud-api",
    status: "healthy",
  });
});

// Error handling middleware (must be last)
app.use(errorHandler);

// Swagger API documentation
setupSwagger(app);

export default app;