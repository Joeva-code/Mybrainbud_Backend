import { Resend } from "resend";
import { env } from "../../config/env";
import { ServiceUnavailableError } from "../../utils/errors";

/**
 * Outbound message delivery abstraction.
 *
 * Delivery is pluggable behind this interface:
 *
 * - "resend"  — production email via the Resend SDK (https://resend.com). Uses
 *               RESEND_API_KEY to send and EMAIL_FROM as the sender. Fails
 *               safely (503) when unconfigured or when the API rejects a send.
 * - "console" — development/test only. Prints the message to the server log.
 *                Refuses to run in production so we never pretend a message
 *                was delivered.
 * - "webhook" — production capable. POSTs { to, subject, text } as JSON to
 *                EMAIL_WEBHOOK_URL (optionally authenticated with
 *                EMAIL_WEBHOOK_TOKEN as a Bearer token), where an email/SMS
 *                provider integration can pick it up.
 * - "none"     — explicitly disables delivery; every send fails safely.
 *
 * When delivery is not configured, callers receive a 503 before any
 * account-dependent logic runs, so failures cannot be used to probe whether
 * an account exists.
 */

export interface DeliveryMessage {
  to: string;
  subject: string;
  text: string;
}

export interface DeliveryProvider {
  readonly name: string;
  send(message: DeliveryMessage): Promise<void>;
}

const DELIVERY_UNAVAILABLE_MESSAGE =
  "Verification delivery is temporarily unavailable. Please try again later.";

/** Returns true when a delivery provider is configured for the current environment. */
export function isDeliveryConfigured(): boolean {
  switch (env.emailDeliveryProvider) {
    case "resend":
      return Boolean(env.resendApiKey && env.emailFrom);
    case "webhook":
      return Boolean(env.emailWebhookUrl);
    case "console":
      // The console provider prints message bodies (including OTP codes), so
      // it must never be used in production.
      return env.nodeEnv !== "production";
    default:
      return false;
  }
}

/**
 * Fails fast (503) when delivery is not configured. Call this before any
 * account lookup so the failure is identical for existing and unknown accounts.
 */
export function ensureDeliveryConfigured(): void {
  if (!isDeliveryConfigured()) {
    throw new ServiceUnavailableError(DELIVERY_UNAVAILABLE_MESSAGE);
  }
}

/**
 * Sends transactional email via the Resend SDK (https://resend.com).
 *
 * The SDK returns a discriminated result: on success `error` is null and `data`
 * carries the message id; on failure `data` is null and `error` describes the
 * rejection. Any failure is surfaced as a generic 503 so callers never leak
 * provider internals to the client.
 */
class ResendDeliveryProvider implements DeliveryProvider {
  readonly name = "resend";

  private readonly client: Resend;

  constructor(
    private readonly apiKey: string,
    private readonly from: string
  ) {
    this.client = new Resend(apiKey);
  }

  async send(message: DeliveryMessage): Promise<void> {
    try {
      const { data, error } = await this.client.emails.send({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });

      if (error || !data) {
        // Log server-side for debugging without exposing details to the client.
        console.error(
          `[Delivery:resend] Send failed${error ? `: ${error.name} (status ${error.statusCode ?? "n/a"})` : ""}`
        );
        throw new ServiceUnavailableError(DELIVERY_UNAVAILABLE_MESSAGE);
      }
    } catch (error) {
      if (error instanceof ServiceUnavailableError) throw error;
      // Network/transport failures are reported the same generic way.
      console.error("[Delivery:resend] Failed to reach the Resend API");
      throw new ServiceUnavailableError(DELIVERY_UNAVAILABLE_MESSAGE);
    }
  }
}

class ConsoleDeliveryProvider implements DeliveryProvider {
  readonly name = "console";

  async send(message: DeliveryMessage): Promise<void> {
    if (env.nodeEnv === "production") {
      // Never print secrets in production — fail safely instead.
      throw new ServiceUnavailableError(DELIVERY_UNAVAILABLE_MESSAGE);
    }
    // Development/test convenience: surfaces the code so the local signup
    // journey can be completed without a configured email provider.
    console.warn(`[Delivery:console] to=${message.to} subject="${message.subject}"`);
    console.warn(`[Delivery:console] ${message.text}`);
  }
}

class WebhookDeliveryProvider implements DeliveryProvider {
  readonly name = "webhook";

  constructor(
    private readonly url: string,
    private readonly token?: string
  ) {}

  async send(message: DeliveryMessage): Promise<void> {
    try {
      const response = await fetch(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify({
          to: message.to,
          subject: message.subject,
          text: message.text,
        }),
      });
      if (!response.ok) {
        console.error(`[Delivery:webhook] Provider responded with status ${response.status}`);
        throw new ServiceUnavailableError(DELIVERY_UNAVAILABLE_MESSAGE);
      }
    } catch (error) {
      if (error instanceof ServiceUnavailableError) throw error;
      console.error("[Delivery:webhook] Failed to reach delivery webhook");
      throw new ServiceUnavailableError(DELIVERY_UNAVAILABLE_MESSAGE);
    }
  }
}

class NoneDeliveryProvider implements DeliveryProvider {
  readonly name = "none";

  async send(): Promise<void> {
    throw new ServiceUnavailableError(DELIVERY_UNAVAILABLE_MESSAGE);
  }
}

let cachedProvider: DeliveryProvider | null = null;

/** Returns the configured delivery provider (memoized per process). */
export function getDeliveryProvider(): DeliveryProvider {
  if (cachedProvider) return cachedProvider;
  switch (env.emailDeliveryProvider) {
    case "resend":
      cachedProvider =
        env.resendApiKey && env.emailFrom
          ? new ResendDeliveryProvider(env.resendApiKey, env.emailFrom)
          : new NoneDeliveryProvider();
      break;
    case "webhook":
      cachedProvider = env.emailWebhookUrl
        ? new WebhookDeliveryProvider(env.emailWebhookUrl, env.emailWebhookToken)
        : new NoneDeliveryProvider();
      break;
    case "console":
      cachedProvider = new ConsoleDeliveryProvider();
      break;
    default:
      cachedProvider = new NoneDeliveryProvider();
      break;
  }
  return cachedProvider;
}

/** Test hook: replaces the memoized provider. Pass null to reset. */
export function setDeliveryProvider(provider: DeliveryProvider | null): void {
  cachedProvider = provider;
}

