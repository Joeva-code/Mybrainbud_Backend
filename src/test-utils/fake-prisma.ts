import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { DeliveryMessage, DeliveryProvider } from "../services/delivery";

/**
 * Lightweight in-memory Prisma fake covering the exact query shapes used by
 * the authentication services. It intentionally does not emulate rollback:
 * transaction-failure scenarios are simulated by making individual
 * operations throw.
 */

export interface FakeUserRow {
  id: string;
  email: string | null;
  phone: string | null;
  passwordHash: string | null;
  firstName: string;
  lastName: string | null;
  role: string;
  authProvider: string | null;
  isVerified: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
}

export interface FakeOtpRow {
  id: string;
  userId: string | null;
  destination: string;
  purpose: string;
  codeHash: string;
  expiresAt: Date;
  verifiedAt: Date | null;
  attempts: number;
  createdAt: Date;
}

export interface FakeSessionRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface FakeResetRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  attempts: number;
  usedAt: Date | null;
  createdAt: Date;
}

export class FakeDb {
  users: FakeUserRow[] = [];
  otps: FakeOtpRow[] = [];
  sessions: FakeSessionRow[] = [];
  resets: FakeResetRow[] = [];
  profiles: Array<{ userId: string; kind: string }> = [];

  /** When true, $transaction(callback) throws before running the callback. */
  failTransaction = false;
  /** When true, user.create throws a P2002 unique-constraint error. */
  throwUniqueOnUserCreate = false;

  reset(): void {
    this.users = [];
    this.otps = [];
    this.sessions = [];
    this.resets = [];
    this.profiles = [];
    this.failTransaction = false;
    this.throwUniqueOnUserCreate = false;
  }
}

function matchesEmail(
  row: FakeUserRow,
  where: { equals?: string; mode?: string } | string | undefined
): boolean {
  if (where === undefined || where === null || !row.email) return false;
  const target = typeof where === "string" ? where : where.equals;
  if (target === undefined) return false;
  if (typeof where !== "string" && where.mode === "insensitive") {
    return row.email.toLowerCase() === target.toLowerCase();
  }
  return row.email === target;
}

export function createFakePrisma(db: FakeDb) {
  const uniqueViolation = () =>
    new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "5.19.1",
    });

  const fake = {
    user: {
      findFirst: async (args: {
        where?: { email?: { equals?: string; mode?: string } };
      }): Promise<FakeUserRow | null> => {
        if (args?.where?.email) {
          return db.users.find((u) => matchesEmail(u, args.where!.email)) ?? null;
        }
        return db.users[0] ?? null;
      },
      findUnique: async (args: { where: { id?: string } }): Promise<FakeUserRow | null> => {
        return db.users.find((u) => u.id === args.where.id) ?? null;
      },
      create: async (args: {
        data: Partial<FakeUserRow> & { firstName: string };
      }): Promise<FakeUserRow> => {
        if (db.throwUniqueOnUserCreate) throw uniqueViolation();
        const email = args.data.email ?? null;
        if (email && db.users.some((u) => (u.email ?? "").toLowerCase() === email.toLowerCase())) {
          throw uniqueViolation();
        }
        const row: FakeUserRow = {
          id: args.data.id ?? randomUUID(),
          email,
          phone: args.data.phone ?? null,
          passwordHash: args.data.passwordHash ?? null,
          firstName: args.data.firstName,
          lastName: args.data.lastName ?? null,
          role: args.data.role ?? "STUDENT",
          authProvider: args.data.authProvider ?? null,
          isVerified: args.data.isVerified ?? false,
          isActive: args.data.isActive ?? true,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastLoginAt: null,
        };
        db.users.push(row);
        return row;
      },
      update: async (args: {
        where: { id: string };
        data: Record<string, unknown>;
      }): Promise<FakeUserRow> => {
        const row = db.users.find((u) => u.id === args.where.id);
        if (!row) throw new Error("Record not found");
        Object.assign(row, args.data, { updatedAt: new Date() });
        return row;
      },
      delete: async (args: { where: { id: string } }): Promise<FakeUserRow> => {
        const idx = db.users.findIndex((u) => u.id === args.where.id);
        if (idx === -1) throw new Error("Record not found");
        const [removed] = db.users.splice(idx, 1);
        // Emulate ON DELETE CASCADE for auth-owned children.
        db.profiles = db.profiles.filter((p) => p.userId !== removed.id);
        db.otps = db.otps.filter((o) => o.userId !== removed.id);
        db.sessions = db.sessions.filter((s) => s.userId !== removed.id);
        db.resets = db.resets.filter((r) => r.userId !== removed.id);
        return removed;
      },
    },

    studentProfile: {
      create: async (args: { data: { userId: string } }) => {
        db.profiles.push({ userId: args.data.userId, kind: "STUDENT" });
        return { userId: args.data.userId };
      },
    },
    parentProfile: {
      create: async (args: { data: { userId: string } }) => {
        db.profiles.push({ userId: args.data.userId, kind: "PARENT" });
        return { userId: args.data.userId };
      },
    },
    teacherProfile: {
      create: async (args: { data: { userId: string } }) => {
        db.profiles.push({ userId: args.data.userId, kind: "TEACHER" });
        return { userId: args.data.userId };
      },
    },

    otpVerification: {
      deleteMany: async (args: {
        where: {
          destination?: string;
          purpose?: string;
          verifiedAt?: null;
          userId?: string;
        };
      }): Promise<{ count: number }> => {
        const before = db.otps.length;
        db.otps = db.otps.filter((o) => {
          const w = args.where ?? {};
          if (w.destination !== undefined && o.destination !== w.destination) return true;
          if (w.purpose !== undefined && o.purpose !== w.purpose) return true;
          if (w.userId !== undefined && o.userId !== w.userId) return true;
          if (w.verifiedAt === null && o.verifiedAt !== null) return true;
          return false;
        });
        return { count: before - db.otps.length };
      },
      create: async (args: {
        data: {
          userId?: string | null;
          destination: string;
          purpose: string;
          codeHash: string;
          expiresAt: Date;
        };
      }): Promise<FakeOtpRow> => {
        const row: FakeOtpRow = {
          id: randomUUID(),
          userId: args.data.userId ?? null,
          destination: args.data.destination,
          purpose: args.data.purpose,
          codeHash: args.data.codeHash,
          expiresAt: args.data.expiresAt,
          verifiedAt: null,
          attempts: 0,
          createdAt: new Date(),
        };
        db.otps.push(row);
        return row;
      },
      findFirst: async (args: {
        where: {
          destination?: string;
          purpose?: string;
          verifiedAt?: null;
        };
        orderBy?: { createdAt?: "asc" | "desc" };
      }): Promise<FakeOtpRow | null> => {
        let rows = db.otps.filter((o) => {
          const w = args.where ?? {};
          if (w.destination !== undefined && o.destination !== w.destination) return false;
          if (w.purpose !== undefined && o.purpose !== w.purpose) return false;
          if (w.verifiedAt === null && o.verifiedAt !== null) return false;
          return true;
        });
        if (args.orderBy?.createdAt === "desc") {
          rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        return rows[0] ?? null;
      },
      updateMany: async (args: {
        where: {
          id?: string;
          verifiedAt?: null;
          attempts?: { lt?: number };
          expiresAt?: { gt?: Date };
        };
        data: { attempts?: { increment?: number }; verifiedAt?: Date };
      }): Promise<{ count: number }> => {
        const rows = db.otps.filter((o) => {
          const w = args.where ?? {};
          if (w.id !== undefined && o.id !== w.id) return false;
          if (w.verifiedAt === null && o.verifiedAt !== null) return false;
          if (w.attempts?.lt !== undefined && !(o.attempts < w.attempts.lt)) return false;
          if (w.expiresAt?.gt !== undefined && !(o.expiresAt > w.expiresAt.gt)) return false;
          return true;
        });
        for (const row of rows) {
          if (args.data.attempts?.increment !== undefined) {
            row.attempts += args.data.attempts.increment;
          }
          if (args.data.verifiedAt) row.verifiedAt = args.data.verifiedAt;
        }
        return { count: rows.length };
      },
      count: async (args: {
        where: { destination?: string; purpose?: string; createdAt?: { gte?: Date } };
      }): Promise<number> =>
        db.otps.filter((o) => {
          const w = args.where ?? {};
          if (w.destination !== undefined && o.destination !== w.destination) return false;
          if (w.purpose !== undefined && o.purpose !== w.purpose) return false;
          if (w.createdAt?.gte !== undefined && !(o.createdAt >= w.createdAt.gte)) return false;
          return true;
        }).length,
    },

    session: {
      create: async (args: {
        data: {
          id?: string;
          userId: string;
          tokenHash: string;
          expiresAt: Date;
        };
      }): Promise<FakeSessionRow> => {
        const row: FakeSessionRow = {
          id: args.data.id ?? randomUUID(),
          userId: args.data.userId,
          tokenHash: args.data.tokenHash,
          expiresAt: args.data.expiresAt,
          createdAt: new Date(),
          revokedAt: null,
        };
        db.sessions.push(row);
        return row;
      },
      findUnique: async (args: { where: { id?: string } }): Promise<FakeSessionRow | null> => {
        return db.sessions.find((s) => s.id === args.where.id) ?? null;
      },
      update: async (args: {
        where: { id: string };
        data: { revokedAt?: Date };
      }): Promise<FakeSessionRow> => {
        const row = db.sessions.find((s) => s.id === args.where.id);
        if (!row) throw new Error("Record not found");
        if (args.data.revokedAt) row.revokedAt = args.data.revokedAt;
        return row;
      },
      updateMany: async (args: {
        where: { userId?: string; revokedAt?: null };
        data: { revokedAt: Date };
      }): Promise<{ count: number }> => {
        const rows = db.sessions.filter((s) => {
          const w = args.where ?? {};
          if (w.userId !== undefined && s.userId !== w.userId) return false;
          if (w.revokedAt === null && s.revokedAt !== null) return false;
          return true;
        });
        for (const row of rows) row.revokedAt = args.data.revokedAt;
        return { count: rows.length };
      },
    },

    passwordResetToken: {
      deleteMany: async (args: { where: { userId: string } }): Promise<{ count: number }> => {
        const before = db.resets.length;
        db.resets = db.resets.filter((r) => r.userId !== args.where.userId);
        return { count: before - db.resets.length };
      },
      create: async (args: {
        data: { userId: string; tokenHash: string; expiresAt: Date };
      }): Promise<FakeResetRow> => {
        const row: FakeResetRow = {
          id: randomUUID(),
          userId: args.data.userId,
          tokenHash: args.data.tokenHash,
          expiresAt: args.data.expiresAt,
          attempts: 0,
          usedAt: null,
          createdAt: new Date(),
        };
        db.resets.push(row);
        return row;
      },
      findUnique: async (args: {
        where: { tokenHash: string };
      }): Promise<FakeResetRow | null> => {
        return db.resets.find((r) => r.tokenHash === args.where.tokenHash) ?? null;
      },
      updateMany: async (args: {
        where: {
          id?: string;
          usedAt?: null;
          attempts?: { lt?: number };
          expiresAt?: { gt?: Date };
        };
        data: { attempts?: { increment?: number }; usedAt?: Date };
      }): Promise<{ count: number }> => {
        const rows = db.resets.filter((r) => {
          const w = args.where ?? {};
          if (w.id !== undefined && r.id !== w.id) return false;
          if (w.usedAt === null && r.usedAt !== null) return false;
          if (w.attempts?.lt !== undefined && !(r.attempts < w.attempts.lt)) return false;
          if (w.expiresAt?.gt !== undefined && !(r.expiresAt > w.expiresAt.gt)) return false;
          return true;
        });
        for (const row of rows) {
          if (args.data.attempts?.increment !== undefined) {
            row.attempts += args.data.attempts.increment;
          }
          if (args.data.usedAt) row.usedAt = args.data.usedAt;
        }
        return { count: rows.length };
      },
    },

    $transaction: async (
      input: Array<Promise<unknown>> | ((tx: unknown) => Promise<unknown>)
    ): Promise<unknown> => {
      if (db.failTransaction) {
        throw new Error("Transaction failed");
      }
      if (typeof input === "function") {
        return input(fake);
      }
      const results: unknown[] = [];
      for (const promise of input) {
        results.push(await promise);
      }
      return results;
    },
  };

  return fake;
}

export type FakePrisma = ReturnType<typeof createFakePrisma>;

/** In-memory delivery provider that records messages and can be made to fail. */
export interface FakeDelivery extends DeliveryProvider {
  sent: DeliveryMessage[];
  failNext: boolean;
}

export function createFakeDelivery(): FakeDelivery {
  const sent: DeliveryMessage[] = [];
  let failNext = false;
  return {
    name: "fake",
    sent,
    get failNext(): boolean {
      return failNext;
    },
    set failNext(value: boolean) {
      failNext = value;
    },
    async send(message: DeliveryMessage): Promise<void> {
      if (failNext) {
        failNext = false;
        throw new Error("Delivery failed");
      }
      sent.push(message);
    },
  };
}

/** Extracts the 4-digit code from a captured delivery message. */
export function extractCode(message: DeliveryMessage): string {
  const match = message.text.match(/code is: (\d{4})/);
  if (!match) throw new Error("No code found in delivery message");
  return match[1];
}

/** Extracts a reset token from a captured delivery message. */
export function extractResetToken(message: DeliveryMessage): string {
  const match = message.text.match(/token to reset your password: ([0-9a-f]{64})/);
  if (!match) throw new Error("No reset token found in delivery message");
  return match[1];
}

