import { createTransport, Transporter } from "nodemailer";
import { EmailParams, MailerSend, Recipient, Sender } from "mailersend";
import { env } from "../../config/env";
import { ServiceUnavailableError } from "../../utils/errors";

/**
 * Outbound message delivery abstraction.
 *
 * Delivery is pluggable behind this interface:
 *
 * - "mailersend" — production email via MailerSend HTTPS API. Uses
 *                MAILERSEND_API_KEY and EMAIL_FROM. Works on Render Free
 *                (no outbound SMTP ports required). Fails safely (503) when
 *                unconfigured or when sending fails.
 * - "gmail"      — production email via Gmail SMTP. Uses SMTP_HOST, SMTP_PORT,
 *                  SMTP_USER, SMTP_PASS, EMAIL_FROM. Uses STARTTLS on port 587.
 *                  Fails safely (503) when unconfigured or when sending fails.
 * - "console"    — development/test only. Prints the message to the server log.
 *                  Refuses to run in production so we never pretend a message
 *                  was delivered.
 * - "none"       — explicitly disables delivery; every send fails safely.
 *
 * When delivery is not configured, callers receive a 503 before any
 * account-dependent logic runs, so failures cannot be used to probe whether
 * an account exists.
 */

export interface DeliveryMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
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
    case "mailersend":
      return Boolean(env.mailersendApiKey && env.emailFrom);
    case "gmail":
      return Boolean(
        env.smtpHost && env.smtpPort && env.smtpUser && env.smtpPass && env.emailFrom
      );
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
 * Sends transactional email via Gmail SMTP.
 *
 * Uses Nodemailer with Gmail SMTP settings. Requires SMTP_HOST, SMTP_PORT,
 * SMTP_USER, SMTP_PASS, and EMAIL_FROM environment variables.
 * Supports both STARTTLS on port 587 (secure: false) and SSL on port 465 (secure: true).
 */
class GmailSmtpDeliveryProvider implements DeliveryProvider {
  readonly name = "gmail";

  private readonly transport: Transporter;

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly user: string,
    private readonly pass: string,
    private readonly from: string
  ) {
    // Use SSL for port 465, STARTTLS for port 587
    const useSSL = port === 465;

    this.transport = createTransport({
      host: this.host,
      port: this.port,
      secure: useSSL, // true for 465 (SSL), false for 587 (STARTTLS)
      auth: {
        user: this.user,
        pass: this.pass,
      },
      // Increased timeouts for cloud environments
      connectionTimeout: 30000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    });

    // Verify connection on startup (non-blocking)
    this.transport.verify().catch((err) => {
      console.error("[Delivery:gmail] SMTP connection verification failed:", err.message);
    });
  }

  async send(message: DeliveryMessage): Promise<void> {
    try {
      const info = await this.transport.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });

      const messageId = (info as { messageId?: string }).messageId ?? "unknown";
      console.log(`[Delivery:gmail] Message sent: ${messageId}`);
    } catch (error) {
      if (error instanceof ServiceUnavailableError) throw error;
      const err = error as Error & { code?: string; command?: string };
      // Handle common SMTP errors
      if (err.code === "EAUTH" || err.code === "EENVELOPE") {
        console.error("[Delivery:gmail] Authentication failed or invalid sender:", err.message);
      } else if (err.code === "ETIMEDOUT" || err.code === "ECONNECTION") {
        console.error("[Delivery:gmail] Connection timeout:", err.message);
      } else if (err.code === "EMESSAGE") {
        console.error("[Delivery:gmail] Message rejected:", err.message);
      } else {
        console.error("[Delivery:gmail] Send failed:", err.message);
      }
      throw new ServiceUnavailableError(DELIVERY_UNAVAILABLE_MESSAGE);
    }
  }
}

/**
 * Sends transactional email via MailerSend HTTPS API.
 *
 * Uses MailerSend SDK with API key. Requires MAILERSEND_API_KEY and
 * EMAIL_FROM environment variables. Works on platforms that block outbound
 * SMTP ports (e.g., Render Free tier) because it uses HTTPS.
 */
class MailerSendDeliveryProvider implements DeliveryProvider {
  readonly name = "mailersend";

  private readonly client: MailerSend;
  private readonly from: Sender;

  constructor(private readonly apiKey: string, private readonly fromEmail: string) {
    this.client = new MailerSend({ apiKey: this.apiKey });
    this.from = new Sender(this.fromEmail);
  }

  async send(message: DeliveryMessage): Promise<void> {
    try {
      const recipients = [new Recipient(message.to)];
      const emailParams = new EmailParams()
        .setFrom(this.from)
        .setTo(recipients)
        .setSubject(message.subject)
        .setText(message.text)
        .setHtml(message.html ?? message.text);

      const result = await this.client.email.send(emailParams);
      // MailerSend API response may have messageId in different formats
      const messageId = (result as { messageId?: string; data?: { messageId?: string } }).messageId
        ?? (result as { data?: { messageId?: string } }).data?.messageId
        ?? "unknown";
      console.log(`[Delivery:mailersend] Message sent: ${messageId}`);
    } catch (error) {
      if (error instanceof ServiceUnavailableError) throw error;
      const err = error as Error & { response?: { status?: number; data?: unknown } };
      // Handle MailerSend API errors
      if (err.response?.status === 401) {
        console.error("[Delivery:mailersend] Authentication failed: invalid API key");
      } else if (err.response?.status === 422) {
        console.error("[Delivery:mailersend] Validation error:", err.response.data);
      } else if (err.response?.status && err.response.status >= 500) {
        console.error("[Delivery:mailersend] MailerSend server error:", err.response.status);
      } else {
        console.error("[Delivery:mailersend] Send failed:", err.message);
      }
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
    case "mailersend":
      cachedProvider =
        env.mailersendApiKey && env.emailFrom
          ? new MailerSendDeliveryProvider(env.mailersendApiKey, env.emailFrom)
          : new NoneDeliveryProvider();
      break;
    case "gmail":
      cachedProvider =
        env.smtpHost && env.smtpPort && env.smtpUser && env.smtpPass && env.emailFrom
          ? new GmailSmtpDeliveryProvider(
              env.smtpHost,
              env.smtpPort,
              env.smtpUser,
              env.smtpPass,
              env.emailFrom
            )
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