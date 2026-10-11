import { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { generateUserId, isPrimaryKeyCollision, USER_ID_LENGTH } from "../utils/id";
import { AuthService } from "../services/auth.service";
import { OtpService } from "../services/otp.service";
import { ConflictError } from "../utils/errors";
import { RegisterDto } from "../types/auth.types";
import {
  FakeDb,
  FakePrisma,
  createFakePrisma,
  createFakeDelivery,
} from "../test-utils/fake-prisma";

describe("generateUserId", () => {
  it("produces ids of the configured length", () => {
    for (let i = 0; i < 100; i++) {
      expect(generateUserId()).toHaveLength(USER_ID_LENGTH);
      expect(USER_ID_LENGTH).toBe(6);
    }
  });

  it("uses only base62 alphanumeric characters", () => {
    const alphabet = /^[A-Za-z0-9]+$/;
    for (let i = 0; i < 200; i++) {
      expect(generateUserId()).toMatch(alphabet);
    }
  });

  it("is effectively unique across many draws (no collisions in 5000)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(generateUserId());
    // With a ~56.8B keyspace, collisions in 5000 draws are astronomically
    // unlikely; assert full uniqueness as a smoke test on the generator.
    expect(seen.size).toBe(5000);
  });
});

describe("isPrimaryKeyCollision", () => {
  const p2002 = (target?: unknown) =>
    new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "5.19.1",
      ...(target !== undefined ? { meta: { target } } : {}),
    });

  it("detects an id (primary key) collision from an array target", () => {
    expect(isPrimaryKeyCollision(p2002(["id"]))).toBe(true);
  });

  it("detects an id collision from a string target", () => {
    expect(isPrimaryKeyCollision(p2002("id"))).toBe(true);
  });

  it("returns false for a non-id unique column (e.g. email)", () => {
    expect(isPrimaryKeyCollision(p2002(["email"]))).toBe(false);
    expect(isPrimaryKeyCollision(p2002("email"))).toBe(false);
  });

  it("returns false for a P2002 with no target and for non-P2002 errors", () => {
    expect(isPrimaryKeyCollision(p2002())).toBe(false);
    expect(isPrimaryKeyCollision(new Error("boom"))).toBe(false);
  });
});

describe("short user ids on account creation", () => {
  let db: FakeDb;
  let fake: FakePrisma;
  let service: AuthService;

  const validDto: RegisterDto = {
    name: "Grace Hopper",
    email: "grace@example.com",
    password: "SecurePass@123",
    role: "STUDENT",
    acceptTerms: true,
  };

  beforeEach(() => {
    db = new FakeDb();
    fake = createFakePrisma(db);
    const otpService = new OtpService(fake as unknown as PrismaClient, createFakeDelivery());
    service = new AuthService(fake as unknown as PrismaClient, { otpService });
  });

  it("assigns a short 6-char id (not a UUID) on registration", async () => {
    await service.register(validDto);
    expect(db.users).toHaveLength(1);
    const id = db.users[0].id;
    expect(id).toHaveLength(6);
    expect(id).toMatch(/^[A-Za-z0-9]{6}$/);
    // A UUID is 36 chars with dashes — make sure we did not fall back to one.
    expect(id).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("retries and succeeds when the generated id collides", async () => {
    // First create attempt collides on the id; the retry should succeed.
    db.throwIdCollisionTimes = 1;
    await service.register(validDto);

    expect(db.users).toHaveLength(1);
    expect(db.users[0].id).toHaveLength(6);
    expect(db.throwIdCollisionTimes).toBe(0);
  });

  it("still surfaces a duplicate-email conflict (not treated as an id collision)", async () => {
    await service.register(validDto);
    await expect(
      service.register({ ...validDto, email: "GRACE@EXAMPLE.COM" })
    ).rejects.toThrow(ConflictError);
    expect(db.users).toHaveLength(1);
  });
});
