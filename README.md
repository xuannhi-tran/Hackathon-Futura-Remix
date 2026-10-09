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

`verdict`, `ruleId` and `visaSubclass` are absent if the client did not send a valid
structured visa profile.

Browser: `app_opened` (once per session), `job_saved` (`verdict`), `job_removed`,
`suggestions_viewed`, plus PostHog's automatic `$pageview`. No other PostHog events are sent
(`$pageleave`, `$web_vitals` and `$exception` are disabled).
