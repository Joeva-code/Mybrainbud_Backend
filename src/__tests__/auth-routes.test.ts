import request from "supertest";
import app from "../app";

/**
 * HTTP-level tests for request validation and authentication guards.
 * These never touch the database: validation rejects before any handler
 * runs, and protected routes reject missing credentials before querying.
 */
describe("auth routes (HTTP)", () => {
  it("GET /health returns 200", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, status: "healthy" });
  });

  it("GET /api/auth/me without a token returns 401", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body).not.toHaveProperty("data.passwordHash");
  });

  it("POST /api/auth/register rejects an empty payload", async () => {
    const res = await request(app).post("/api/auth/register").send({});
    expect(res.status).toBe(422); // existing validation error convention
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("Validation failed");
    expect(Array.isArray(res.body.errors)).toBe(true);
  });

  it("POST /api/auth/register requires accepted terms", async () => {
    const res = await request(app).post("/api/auth/register").send({
      firstName: "John",
      email: "john@example.com",
      password: "SecurePass@123",
      acceptTerms: false,
    });
    expect(res.status).toBe(422);
    expect(res.body.errors.some((e: { field: string }) => e.field === "acceptTerms")).toBe(
      true
    );
  });

  it("POST /api/auth/register rejects privileged roles", async () => {
    const res = await request(app).post("/api/auth/register").send({
      firstName: "Root",
      email: "root@example.com",
      password: "SecurePass@123",
      acceptTerms: true,
      role: "ADMIN",
    });
    expect(res.status).toBe(422);
  });

  it("POST /api/auth/verify-otp rejects non 4-digit codes", async () => {
    const res = await request(app).post("/api/auth/verify-otp").send({
      email: "john@example.com",
      code: "12",
    });
    expect(res.status).toBe(422);
    expect(res.body.errors.some((e: { field: string }) => e.field === "code")).toBe(true);
  });

  it("POST /api/auth/refresh without body or cookie returns 400", async () => {
    const res = await request(app).post("/api/auth/refresh").send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Refresh token is required");
  });

  it("POST /api/auth/forgot-password rejects invalid emails", async () => {
    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "not-an-email" });
    expect(res.status).toBe(422);
  });
});
