import { env } from "../config/env";
import {
  getDeliveryProvider,
  isDeliveryConfigured,
  setDeliveryProvider,
} from "../services/delivery";
import { ServiceUnavailableError } from "../utils/errors";
import { MailerSend } from "mailersend";

// Mock MailerSend SDK so no network calls are made.
const mockSend = jest.fn();

jest.mock("mailersend", () => ({
  MailerSend: jest.fn().mockImplementation(() => ({
    email: {
      send: mockSend,
    },
  })),
  EmailParams: jest.fn().mockImplementation(() => ({
    setFrom: jest.fn().mockReturnThis(),
    setTo: jest.fn().mockReturnThis(),
    setSubject: jest.fn().mockReturnThis(),
    setText: jest.fn().mockReturnThis(),
    setHtml: jest.fn().mockReturnThis(),
  })),
  Sender: jest.fn().mockImplementation((email) => ({ email })),
  Recipient: jest.fn().mockImplementation((email) => ({ email })),
}));

describe("MailerSend HTTPS delivery provider", () => {
  const original = {
    provider: env.emailDeliveryProvider,
    apiKey: env.mailersendApiKey,
    from: env.emailFrom,
  };

  const configure = (opts: {
    provider: string;
    apiKey?: string;
    from?: string;
  }) => {
    (env as { emailDeliveryProvider: string }).emailDeliveryProvider = opts.provider;
    (env as { mailersendApiKey?: string }).mailersendApiKey = opts.apiKey;
    (env as { emailFrom?: string }).emailFrom = opts.from;
  };

  beforeEach(() => {
    mockSend.mockReset();
    (MailerSend as unknown as jest.Mock).mockClear();
    setDeliveryProvider(null);
  });

  afterEach(() => {
    configure({
      provider: original.provider,
      apiKey: original.apiKey,
      from: original.from,
    });
    setDeliveryProvider(null);
  });

  it("is configured only when API key and sender are present", () => {
    configure({
      provider: "mailersend",
      apiKey: "mlsn.test-api-key",
      from: "MyBrainBud <verification@mybrainbud.com>",
    });
    expect(isDeliveryConfigured()).toBe(true);

    configure({ provider: "mailersend", apiKey: undefined, from: "App <no-reply@example.com>" });
    expect(isDeliveryConfigured()).toBe(false);

    configure({ provider: "mailersend", apiKey: "mlsn.test-api-key", from: undefined });
    expect(isDeliveryConfigured()).toBe(false);
  });

  it("sends via MailerSend SDK and resolves on success", async () => {
    configure({
      provider: "mailersend",
      apiKey: "mlsn.test-api-key",
      from: "MyBrainBud <verification@mybrainbud.com>",
    });
    mockSend.mockResolvedValue({ messageId: "msg_1234567890" });

    const provider = getDeliveryProvider();
    expect(provider.name).toBe("mailersend");

    await expect(
      provider.send({
        to: "user@example.com",
        subject: "Code",
        text: "Your code is 1234",
        html: "<p>Your code is 1234</p>",
      })
    ).resolves.toBeUndefined();

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(MailerSend).toHaveBeenCalledWith({ apiKey: "mlsn.test-api-key" });
  });

  it("fails safely with 503 on authentication failure (401)", async () => {
    configure({
      provider: "mailersend",
      apiKey: "invalid-key",
      from: "App <no-reply@example.com>",
    });
    const authError = new Error("Unauthorized") as Error & { response: { status: number } };
    authError.response = { status: 401 };
    mockSend.mockRejectedValue(authError);

    const provider = getDeliveryProvider();
    await expect(
      provider.send({ to: "user@example.com", subject: "Code", text: "x" })
    ).rejects.toThrow(ServiceUnavailableError);
  });

  it("fails safely with 503 on validation error (422)", async () => {
    configure({
      provider: "mailersend",
      apiKey: "mlsn.test-api-key",
      from: "App <no-reply@example.com>",
    });
    const validationError = new Error("Unprocessable Entity") as Error & { response: { status: number; data: unknown } };
    validationError.response = { status: 422, data: { errors: ["Invalid recipient"] } };
    mockSend.mockRejectedValue(validationError);

    const provider = getDeliveryProvider();
    await expect(
      provider.send({ to: "user@example.com", subject: "Code", text: "x" })
    ).rejects.toThrow(ServiceUnavailableError);
  });

  it("fails safely with 503 on MailerSend server error (500)", async () => {
    configure({
      provider: "mailersend",
      apiKey: "mlsn.test-api-key",
      from: "App <no-reply@example.com>",
    });
    const serverError = new Error("Internal Server Error") as Error & { response: { status: number } };
    serverError.response = { status: 500 };
    mockSend.mockRejectedValue(serverError);

    const provider = getDeliveryProvider();
    await expect(
      provider.send({ to: "user@example.com", subject: "Code", text: "x" })
    ).rejects.toThrow(ServiceUnavailableError);
  });

  it("fails safely with 503 on a network failure", async () => {
    configure({
      provider: "mailersend",
      apiKey: "mlsn.test-api-key",
      from: "App <no-reply@example.com>",
    });
    mockSend.mockRejectedValue(new Error("network down"));

    const provider = getDeliveryProvider();
    await expect(
      provider.send({ to: "user@example.com", subject: "Code", text: "x" })
    ).rejects.toThrow(ServiceUnavailableError);
  });

  it("falls back to a no-op provider when mailersend is unconfigured", async () => {
    configure({ provider: "mailersend", apiKey: undefined, from: undefined });

    const provider = getDeliveryProvider();
    expect(provider.name).toBe("none");
    await expect(
      provider.send({ to: "user@example.com", subject: "Code", text: "x" })
    ).rejects.toThrow(ServiceUnavailableError);
    expect(mockSend).not.toHaveBeenCalled();
    expect(MailerSend).not.toHaveBeenCalled();
  });
});