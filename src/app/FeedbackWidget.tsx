"use client";

import { useState } from "react";

import { analyticsHeaders } from "../lib/analyticsClient";

const MAX_COMMENT = 500;
const MAX_EMAIL = 254;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

type Status = "idle" | "sending" | "sent" | "error";

/** Small feedback button + form. Comment and email go only to /api/feedback. */
export default function FeedbackWidget() {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState<"up" | "down" | null>(null);
  const [comment, setComment] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  function reset() {
    setRating(null);
    setComment("");
    setEmail("");
    setStatus("idle");
    setMessage("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    if (!rating) {
      setStatus("error");
      setMessage("Please choose thumbs up or thumbs down.");
      return;
    }

    const trimmedEmail = email.trim();

    if (trimmedEmail && !EMAIL_RE.test(trimmedEmail)) {
      setStatus("error");
      setMessage("That email address does not look valid.");
      return;
    }

    setStatus("sending");
    setMessage("");

    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...analyticsHeaders() },
        body: JSON.stringify({
          rating,
          comment: comment.trim() || undefined,
          email: trimmedEmail || undefined,
        }),
      });

      if (response.ok) {
        setStatus("sent");
        return;
      }

      setStatus("error");
      setMessage(
        response.status === 429
          ? "You have sent a few already. Please try again in a little while."
          : "Sorry, feedback could not be sent right now. Please try again later."
      );
    } catch {
      setStatus("error");
      setMessage("Sorry, feedback could not be sent right now.");
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm hover:bg-gray-50"
      >
        Feedback
      </button>
    );
  }

  return (
    <section
      aria-label="Send feedback"
      className="max-w-md rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
    >
      {status === "sent" ? (
        <div className="space-y-3 text-sm text-gray-700">
          <p>Thanks, your feedback was sent.</p>
          <button
            type="button"
            onClick={() => {
              reset();
              setOpen(false);
            }}
            className="rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100"
          >
            Close
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-3 text-sm">
          <fieldset>
            <legend className="mb-1 font-medium text-gray-800">
              How is JobCompass working for you?
            </legend>
            <div className="flex gap-2">
              <button
                type="button"
                aria-pressed={rating === "up"}
                onClick={() => setRating("up")}
                className={`rounded-md border px-3 py-1.5 ${
                  rating === "up"
                    ? "border-green-500 bg-green-50 text-green-800"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                <span aria-hidden="true">👍</span> Good
              </button>
              <button
                type="button"
                aria-pressed={rating === "down"}
                onClick={() => setRating("down")}
                className={`rounded-md border px-3 py-1.5 ${
                  rating === "down"
                    ? "border-red-500 bg-red-50 text-red-800"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}
              >
                <span aria-hidden="true">👎</span> Not good
              </button>
            </div>
          </fieldset>

          <label className="block">
            <span className="text-gray-700">Comment (optional)</span>
            <textarea
              value={comment}
              maxLength={MAX_COMMENT}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              className="mt-1 w-full rounded-md border border-gray-200 p-2 text-sm"
            />
            <span className="text-xs text-gray-400">
              {comment.length}/{MAX_COMMENT}. Please do not include personal
              details.
            </span>
          </label>

          <label className="block">
            <span className="text-gray-700">
              Email (only if you want a reply)
            </span>
            <input
              type="email"
              value={email}
              maxLength={MAX_EMAIL}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="mt-1 w-full rounded-md border border-gray-200 p-2 text-sm"
            />
          </label>

          {message && (
            <p role="alert" className="text-xs font-medium text-red-700">
              {message}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={status === "sending"}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
            >
              {status === "sending" ? "Sending…" : "Send feedback"}
            </button>
            <button
              type="button"
              onClick={() => {
                reset();
                setOpen(false);
              }}
              className="rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
