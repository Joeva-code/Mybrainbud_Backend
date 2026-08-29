import { config } from "dotenv";
import { join } from "path";

// Load environment variables based on NODE_ENV
const envFile = process.env.NODE_ENV === "test" ? ".env.test" : ".env";
config({ path: join(process.cwd(), envFile) });

// Validate required environment variables
const requiredEnvVars = [
  "DATABASE_URL",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "PORT",
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
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
};