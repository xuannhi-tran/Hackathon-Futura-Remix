This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Anonymous usage analytics (PostHog)

JobCompass records a few anonymous usage statistics (weekly active users, ads
analysed, verdict distribution, latency, cache hit rate, error rate). **Job ad
text, extracted text, profile free text and anything a user typed are never
included in these statistics.** This is separate from ad processing: the ad
text you submit is sent to Google's Gemini API to extract the requirements
(and the raw model output is cached, without the ad text, when Redis is
configured). The footer note says the same. Analytics is off unless a key is configured, so local development, tests
and previews without the key behave exactly as before.

### Environment variables

| Name | Purpose |
|---|---|
| `NEXT_PUBLIC_POSTHOG_KEY` | PostHog project API key (starts with `phc_`). Unset = analytics fully disabled. |
| `NEXT_PUBLIC_POSTHOG_HOST` | PostHog ingestion host, e.g. `https://eu.i.posthog.com` (default `https://us.i.posthog.com`). |

### How it works

- Anonymous id: a random UUID (`crypto.randomUUID`) kept in `localStorage`
  (in memory if storage is blocked). It is the PostHog `distinct_id` and is sent
  to the API routes in the `x-anon-id` header; the server accepts it only if it
  is a valid UUID, otherwise events use `"unknown"`.
- No autocapture, session recording, heatmaps, web vitals / performance capture, exception capture, surveys or person profiles. Server
  events disable geo-IP. Do Not Track (and Global Privacy Control) is respected on
  the client and server.
- Requests with a valid `x-eval-token` are never tracked.
- Analytics never blocks or fails a request: browser events are fire-and-forget,
  server events are sent after the response (`after()`), and every call is wrapped
  in `try/catch`.
- Everything is defined in `src/lib/analyticsSchema.ts` (whitelist),
  `src/lib/analytics.ts` (server) and `src/lib/analyticsClient.ts` (browser).
  Unknown events, unknown properties and values outside the allowed sets are dropped.

### Events and properties

Server (`/api/extract`, `/api/tailor-advice`):

| Event | Properties |
|---|---|
| `analyse_job` | `verdict` (APPLY/TAILOR/SKIP), `ruleId`, `visaSubclass` (500/485), `cacheHit`, `degraded` (model output unusable, fallbacks only), `latencyMs`, `adLengthBucket` (`<1k`, `1-3k`, `3-6k`, `>6k`) |
| `tailor_advice_requested` | `latencyMs`, `success` |
| `request_refused` | `reason` (`rate_limited`, `quota_cap`, `upstream_error`), `route` (`extract`, `tailor-advice`) |
| `feedback_submitted` | `rating` (`up`/`down`) only; the comment and email are never sent to PostHog |

`verdict`, `ruleId` and `visaSubclass` are absent if the client did not send a valid
structured visa profile.

Browser: `app_opened` (once per session), `job_saved` (`verdict`), `job_removed`,
`suggestions_viewed`, plus PostHog's automatic `$pageview`. No other PostHog events are sent
(`$pageleave`, `$web_vitals` and `$exception` are disabled).

## Saved jobs and profile (this browser only)

Saved jobs (at most the 50 most recent) and the profile form values are kept in
`localStorage` under `jobcompass:saved:v1` and `jobcompass:profile:v1` so they
survive a refresh. They are validated on load (malformed data is dropped), are
never sent to the server or analytics, and the app works normally if storage is
unavailable. "Clear saved jobs" in the portfolio removes the saved list.

## Feedback

The "Feedback" button opens a form: thumbs up/down (required), an optional
comment (max 500 characters) and an optional email (max 254 characters, "only if
you want a reply"). `POST /api/feedback`:

- validates the body strictly (unknown fields are rejected);
- has its own per-client rate limit, separate from the Gemini limits and quota
  (`FEEDBACK_RATE_LIMIT_PER_10_MIN`, default 5; `FEEDBACK_RATE_LIMIT_PER_DAY`,
  default 20); requests with a valid `x-eval-token` skip it;
- stores each entry in the Redis list `feedback:v1` (newest first, at most 500
  entries). The list has a 90-day TTL that is refreshed on each submission;
- if Redis is not configured it returns success and stores nothing; if Redis
  fails it returns 503 and logs only the error name;
- never logs the comment or email, and sends PostHog only `feedback_submitted`
  with `rating`.

If you leave a comment or email in feedback, it is stored to improve the app.
The footer asks users to email tranvoxuannhi2k6@gmail.com if they would like it
deleted (the address lives in one constant, `CONTACT_EMAIL` in
`src/lib/siteConfig.ts`, and is never sent to analytics).

**Reading feedback:** in the Upstash console (Data Browser or CLI) run
`LRANGE feedback:v1 0 -1`. Each item is JSON: `{ id, at, rating, comment?, email? }`.
To delete one entry, `LREM feedback:v1 1 '<the exact item>'`; to delete all,
`DEL feedback:v1`.

