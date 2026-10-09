import app from "./app";
import { env } from "./config/env";
import prisma, { testConnection } from "./lib/prisma";

const PORT = env.port;

async function startServer() {
  const dbConnected = await testConnection();
  
  if (!dbConnected) {
    console.error("[Server] Database connection failed. Exiting...");
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    console.log(`[Server] MyBrainBud API running on port ${PORT}`);
    console.log(`[Server] Environment: ${env.nodeEnv}`);
  });

  // Graceful shutdown
  async function gracefulShutdown(signal: string) {
    console.log(`\n[Server] ${signal} received. Shutting down gracefully...`);

    server.close(async () => {
      console.log("[Server] HTTP server closed.");
      await prisma.$disconnect();
      console.log("[Server] Database disconnected.");
      process.exit(0);
    });

    setTimeout(() => {
      console.error("[Server] Forced shutdown after timeout.");
      process.exit(1);
    }, 10000);
  }

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

startServer();