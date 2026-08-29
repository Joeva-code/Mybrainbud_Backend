import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  log: [
    { emit: "event", level: "info" },
    { emit: "event", level: "warn" },
    { emit: "event", level: "error" },
  ],
});

(prisma.$on as any)("info", (e: any) => {
  console.log(`[Prisma Info] ${e.message}`);
});

(prisma.$on as any)("warn", (e: any) => {
  console.warn(`[Prisma Warn] ${e.message}`);
});

(prisma.$on as any)("error", (e: any) => {
  console.error(`[Prisma Error] ${e.message}`);
});

export async function testConnection(): Promise<boolean> {
  try {
    await prisma.$connect();
    console.log("[Database] Connected successfully to PostgreSQL");
    return true;
  } catch (error) {
    console.error("[Database] Failed to connect:");
    if (error instanceof Error) {
      console.error(`[Database] ${error.message}`);
    } else {
      console.error(`[Database] Unknown error: ${error}`);
    }
    return false;
  }
}

async function gracefulShutdown(signal: string) {
  console.log(`\n[Database] ${signal} received. Closing Prisma client...`);
  await prisma.$disconnect();
  console.log("[Database] Disconnected.");
  process.exit(0);
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

export default prisma;