import { trackServer } from "../../../lib/analytics";
import {
  MAX_FEEDBACK_BODY_CHARS,
  storeFeedback,
  validateFeedback,
} from "../../../lib/feedback";
import { enforceFeedbackLimit, logRedisProblem } from "../../../lib/geminiGuard";

function badRequest(error: string) {
  return Response.json({ error }, { status: 400 });
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    const raw = await request.text();

    if (raw.length > MAX_FEEDBACK_BODY_CHARS) {
      return badRequest("Request body is too large.");
    }

    body = JSON.parse(raw);
  } catch {
    return badRequest("Request body must be valid JSON.");
  }

  const result = validateFeedback(body);

  if (!result.ok) {
    return badRequest(result.error);
  }

  const limited = await enforceFeedbackLimit(request);

  if (limited) {
    return limited;
  }

  try {
    await storeFeedback(result.value);
  } catch (error) {
    // Error name only: never the comment, the email or the Redis message.
    logRedisProblem(error);

    return Response.json(
      {
        error: "Feedback could not be saved right now. Please try again later.",
        code: "feedback_unavailable",
      },
      { status: 503 }
    );
  }

  // Only the rating goes to analytics.
  trackServer(request, "feedback_submitted", { rating: result.value.rating });

  return Response.json({ ok: true });
}
