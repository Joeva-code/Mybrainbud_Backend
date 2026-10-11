import { randomInt } from "node:crypto";
import { Prisma } from "@prisma/client";

/**
 * Short, human-friendly primary keys for user accounts.
 *
 * User IDs are generated in the application (not by the database) so they can
 * be short and readable. A 6-character base62 key has ~56.8 billion
 * combinations; because that space is finite, creation retries on the rare
 * primary-key collision rather than surfacing an error (see AuthService).
 */

/** Length of a generated user id (characters). */
export const USER_ID_LENGTH = 6;

/**
 * Unambiguous-ish base62 alphabet (a-z, A-Z, 0-9). Kept dense to maximise the
 * keyspace within the fixed length.
 */
const USER_ID_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/** Generates a cryptographically-random user id of {@link USER_ID_LENGTH} chars. */
export function generateUserId(length: number = USER_ID_LENGTH): string {
  let id = "";
  for (let i = 0; i < length; i++) {
    // randomInt is exclusive of the upper bound -> uniform over the alphabet.
    id += USER_ID_ALPHABET[randomInt(0, USER_ID_ALPHABET.length)];
  }
  return id;
}

/** True when the error is a Prisma unique-constraint violation (P2002). */
function isUniqueViolation(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

/**
 * True when a P2002 was raised on the primary key (`id`) rather than another
 * unique column (e.g. `email`). Used to decide whether to retry id generation.
 *
 * Prisma reports the colliding column(s) in `meta.target`, either as an array
 * of field names or a single string, depending on the driver.
 */
export function isPrimaryKeyCollision(error: unknown): boolean {
  if (!isUniqueViolation(error)) return false;
  const target = error.meta?.target;
  const fields = Array.isArray(target)
    ? target
    : typeof target === "string"
      ? [target]
      : [];
  return fields.some((field) => String(field).toLowerCase() === "id");
}
