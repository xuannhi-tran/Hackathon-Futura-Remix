/**
 * Feedback validation and storage for /api/feedback.
 *
 * Entries are kept in one Redis list (newest first). Read them with
 * `LRANGE feedback:v1 0 -1`. The list holds at most 500 entries and its TTL is
 * refreshed on every write, so it disappears 90 days after the last submission.
 * Comments and emails are never logged or sent to analytics.
 */

import { randomUUID } from "node:crypto";

import { getRedis } from "./redisClient";

export const FEEDBACK_KEY = "feedback:v1";
export const MAX_FEEDBACK_ENTRIES = 500;
export const FEEDBACK_TTL_SECONDS = 90 * 24 * 60 * 60;
export const MAX_FEEDBACK_BODY_CHARS = 4000;
export const MAX_COMMENT_CHARS = 500;
export const MAX_EMAIL_CHARS = 254;

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

export type Feedback = {
  rating: "up" | "down";
  comment?: string;
  email?: string;
};

export type FeedbackResult =
  | { ok: true; value: Feedback }
  | { ok: false; error: string };

/** Strict validation: only rating, comment and email are accepted. */
export function validateFeedback(body: unknown): FeedbackResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  const record = body as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (key !== "rating" && key !== "comment" && key !== "email") {
      return { ok: false, error: `Unexpected field: ${key.slice(0, 40)}.` };
    }
  }

  if (record.rating !== "up" && record.rating !== "down") {
    return { ok: false, error: 'rating must be "up" or "down".' };
  }

  const value: Feedback = { rating: record.rating };

  if (record.comment !== undefined) {
    if (typeof record.comment !== "string") {
      return { ok: false, error: "comment must be a string." };
    }

    const comment = record.comment.trim();

    if (comment.length > MAX_COMMENT_CHARS) {
      return {
        ok: false,
        error: `comment must be at most ${MAX_COMMENT_CHARS} characters.`,
      };
    }
    if (comment) value.comment = comment;
  }

  if (record.email !== undefined) {
    if (typeof record.email !== "string") {
      return { ok: false, error: "email must be a string." };
    }

    const email = record.email.trim();

    if (email.length > MAX_EMAIL_CHARS) {
      return {
        ok: false,
        error: `email must be at most ${MAX_EMAIL_CHARS} characters.`,
      };
    }
    if (email && !EMAIL_RE.test(email)) {
      return { ok: false, error: "email does not look valid." };
    }
    if (email) value.email = email;
  }

  return { ok: true, value };
}

/**
 * Stores one entry. Returns "skipped" when Redis is not configured; throws if
 * Redis fails (the caller logs the error name only).
 */
export async function storeFeedback(
  feedback: Feedback
): Promise<"stored" | "skipped"> {
  const redis = getRedis();

  if (!redis) return "skipped";

  await redis.pushCapped(
    FEEDBACK_KEY,
    JSON.stringify({
      id: randomUUID(),
      at: new Date().toISOString(),
      ...feedback,
    }),
    MAX_FEEDBACK_ENTRIES,
    FEEDBACK_TTL_SECONDS
  );

  return "stored";
}
