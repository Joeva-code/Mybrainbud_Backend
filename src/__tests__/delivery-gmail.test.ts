import { createTransport } from "nodemailer";
import { env } from "../config/env";
import {
  getDeliveryProvider,
  isDeliveryConfigured,
  setDeliveryProvider,
} from "../services/delivery";
import { ServiceUnavailableError } from "../utils/errors";

// Mock nodemailer so no network calls are made.
const mockSendMail = jest.fn();
const mockVerify = jest.fn();

jest.mock("nodemailer", () => ({
  createTransport: jest.fn().mockImplementation(() => ({
    sendMail: mockSendMail,
    verify: mockVerify,
  })),
}));

describe("Gmail SMTP delivery provider", () => {
  const original = {
    provider: env.emailDeliveryProvider,
    host: env.smtpHost,
    port: env.smtpPort,
    user: env.smtpUser,
    pass: env.smtpPass,
    from: env.emailFrom,
  };

  const configure = (opts: {
    provider: string;
    host?: string;
    port?: number;
    user?: string;
    pass?: string;
    from?: string;
  }) => {
    (env as { emailDeliveryProvider: string }).emailDeliveryProvider = opts.provider;
    (env as { smtpHost?: string }).smtpHost = opts.host;
    (env as { smtpPort?: number }).smtpPort = opts.port;
    (env as { smtpUser?: string }).smtpUser = opts.user;
    (env as { smtpPass?: string }).smtpPass = opts.pass;
    (env as { emailFrom?: string }).emailFrom = opts.from;
  };

  beforeEach(() => {
    mockSendMail.mockReset();
    mockVerify.mockReset();
    (createTransport as unknown as jest.Mock).mockClear();
    setDeliveryProvider(null);
  });

  afterEach(() => {
    configure({
      provider: original.provider,
      host: original.host,
      port: original.port,
      user: original.user,
      pass: original.pass,
      from: original.from,
    });
    setDeliveryProvider(null);
  });

  it("is configured only when all SMTP credentials and sender are present", () => {
    configure({
      provider: "gmail",
      host: "smtp.gmail.com",
      port: 587,
      user: "test@gmail.com",
      pass: "app-password",
      from: "MyBrainBud <verification@mybrainbud.com>",
    });
    expect(isDeliveryConfigured()).toBe(true);

    configure({ provider: "gmail", host: undefined, port: 587, user: "test@gmail.com", pass: "app-password", from: "App <no-reply@example.com>" });
    expect(isDeliveryConfigured()).toBe(false);

    configure({ provider: "gmail", host: "smtp.gmail.com", port: 587, user: undefined, pass: "app-password", from: "App <no-reply@example.com>" });
    expect(isDeliveryConfigured()).toBe(false);

    configure({ provider: "gmail", host: "smtp.gmail.com", port: 587, user: "test@gmail.com", pass: undefined, from: "App <no-reply@example.com>" });
    expect(isDeliveryConfigured()).toBe(false);

    configure({ provider: "gmail", host: "smtp.gmail.com", port: 587, user: "test@gmail.com", pass: "app-password", from: undefined });
    expect(isDeliveryConfigured()).toBe(false);
  });

  it("sends via nodemailer and resolves on success", async () => {
    configure({
      provider: "gmail",
      host: "smtp.gmail.com",
      port: 587,
      user: "test@gmail.com",
      pass: "app-password",
      from: "MyBrainBud <verification@mybrainbud.com>",
    });
    mockSendMail.mockResolvedValue({ messageId: "<msg123@domain>" });
    mockVerify.mockResolvedValue(undefined);

    const provider = getDeliveryProvider();
    expect(provider.name).toBe("gmail");

    await expect(
      provider.send({ to: "user@example.com", subject: "Code", text: "Your code is 1234", html: "<p>Your code is 1234</p>" })
    ).resolves.toBeUndefined();

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail).toHaveBeenCalledWith({
      from: "MyBrainBud <verification@mybrainbud.com>",
      to: "user@example.com",
      subject: "Code",
      text: "Your code is 1234",
      html: "<p>Your code is 1234</p>",
    });
    expect(createTransport).toHaveBeenCalledWith({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: { user: "test@gmail.com", pass: "app-password" },
      connectionTimeout: 10000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
    });
  });

  it("fails safely with 503 on authentication failure (EAUTH)", async () => {
    configure({
      provider: "gmail",
      host: "smtp.gmail.com",
      port: 587,
      user: "test@gmail.com",
      pass: "wrong-password",
      from: "App <no-reply@example.com>",
    });
    const authError = new Error("Invalid login") as Error & { code: string };
    authError.code = "EAUTH";
    mockSendMail.mockRejectedValue(authError);
    mockVerify.mockResolvedValue(undefined);

    const provider = getDeliveryProvider();
    await expect(
      provider.send({ to: "user@example.com", subject: "Code", text: "x" })
    ).rejects.toThrow(ServiceUnavailableError);
  });

  it("fails safely with 503 on connection timeout (ETIMEDOUT)", async () => {
    configure({
      provider: "gmail",
      host: "smtp.gmail.com",
      port: 587,
      user: "test@gmail.com",
      pass: "app-password",
      from: "App <no-reply@example.com>",
    });
    const timeoutError = new Error("Connection timeout") as Error & { code: string };
    timeoutError.code = "ETIMEDOUT";
    mockSendMail.mockRejectedValue(timeoutError);
    mockVerify.mockResolvedValue(undefined);

    const provider = getDeliveryProvider();
    await expect(
      provider.send({ to: "user@example.com", subject: "Code", text: "x" })
    ).rejects.toThrow(ServiceUnavailableError);
  });

  it("fails safely with 503 on a transport/network failure", async () => {
    configure({
      provider: "gmail",
      host: "smtp.gmail.com",
      port: 587,
      user: "test@gmail.com",
      pass: "app-password",
      from: "App <no-reply@example.com>",
    });
    mockSendMail.mockRejectedValue(new Error("network down"));
    mockVerify.mockResolvedValue(undefined);

    const provider = getDeliveryProvider();
    await expect(
      provider.send({ to: "user@example.com", subject: "Code", text: "x" })
    ).rejects.toThrow(ServiceUnavailableError);
  });

  it("falls back to a no-op provider when gmail is unconfigured", async () => {
    configure({ provider: "gmail", host: undefined, port: 587, user: undefined, pass: undefined, from: undefined });

    const provider = getDeliveryProvider();
    expect(provider.name).toBe("none");
    await expect(
      provider.send({ to: "user@example.com", subject: "Code", text: "x" })
    ).rejects.toThrow(ServiceUnavailableError);
    expect(mockSendMail).not.toHaveBeenCalled();
    expect(createTransport).not.toHaveBeenCalled();
  });
});