import { Resend } from "resend";
import { env } from "../config/env";
import {
  getDeliveryProvider,
  isDeliveryConfigured,
  setDeliveryProvider,
} from "../services/delivery";
import { ServiceUnavailableError } from "../utils/errors";

// Mock the Resend SDK so no network calls are made. `mockSend` is referenced
// from the hoisted jest.mock factory (jest allows the `mock`-prefixed name).
const mockSend = jest.fn();

jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}));

describe("Resend delivery provider", () => {
  const original = {
    provider: env.emailDeliveryProvider,
    key: env.resendApiKey,
    from: env.emailFrom,
  };

  const configure = (opts: { provider: string; key?: string; from?: string }) => {
    (env as { emailDeliveryProvider: string }).emailDeliveryProvider = opts.provider;
    (env as { resendApiKey?: string }).resendApiKey = opts.key;
    (env as { emailFrom?: string }).emailFrom = opts.from;
  };

  beforeEach(() => {
    mockSend.mockReset();
    (Resend as unknown as jest.Mock).mockClear();
    // Reset the memoized provider so each test resolves a fresh one.
    setDeliveryProvider(null);
  });

  afterEach(() => {
    configure({
      provider: original.provider,
      key: original.key,
      from: original.from,
    });
    setDeliveryProvider(null);
  });

  it("is configured only when both the API key and sender are present", () => {
    configure({ provider: "resend", key: "re_test", from: "App <no-reply@example.com>" });
    expect(isDeliveryConfigured()).toBe(true);

    configure({ provider: "resend", key: undefined, from: "App <no-reply@example.com>" });
    expect(isDeliveryConfigured()).toBe(false);

    configure({ provider: "resend", key: "re_test", from: undefined });
    expect(isDeliveryConfigured()).toBe(false);
  });

  it("sends via the Resend SDK and resolves on success", async () => {
    configure({ provider: "resend", key: "re_test", from: "MyBrainBud <verification@mybrainbud.com>" });
    mockSend.mockResolvedValue({ data: { id: "email_123" }, error: null });

    const provider = getDeliveryProvider();
    expect(provider.name).toBe("resend");

    await expect(
      provider.send({ to: "user@example.com", subject: "Code", text: "Your code is 1234" })
    ).resolves.toBeUndefined();

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith({
      from: "MyBrainBud <verification@mybrainbud.com>",
      to: "user@example.com",
      subject: "Code",
      text: "Your code is 1234",
    });
    expect(Resend).toHaveBeenCalledWith("re_test");
  });

  it("fails safely with 503 when the Resend API returns an error", async () => {
    configure({ provider: "resend", key: "re_test", from: "App <no-reply@example.com>" });
    mockSend.mockResolvedValue({
      data: null,
      error: { name: "invalid_api_key", message: "Invalid API key", statusCode: 401 },
    });

    const provider = getDeliveryProvider();
    await expect(
      provider.send({ to: "user@example.com", subject: "Code", text: "x" })
    ).rejects.toThrow(ServiceUnavailableError);
  });

  it("fails safely with 503 on a transport/network failure", async () => {
    configure({ provider: "resend", key: "re_test", from: "App <no-reply@example.com>" });
    mockSend.mockRejectedValue(new Error("network down"));

    const provider = getDeliveryProvider();
    await expect(
      provider.send({ to: "user@example.com", subject: "Code", text: "x" })
    ).rejects.toThrow(ServiceUnavailableError);
  });

  it("falls back to a no-op provider when resend is unconfigured", async () => {
    configure({ provider: "resend", key: undefined, from: undefined });

    const provider = getDeliveryProvider();
    expect(provider.name).toBe("none");
    await expect(
      provider.send({ to: "user@example.com", subject: "Code", text: "x" })
    ).rejects.toThrow(ServiceUnavailableError);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
