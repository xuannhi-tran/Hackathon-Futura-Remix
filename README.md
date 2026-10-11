# JobCompass 🧭

**Paste a job ad, find out in seconds whether it's worth your time.**

JobCompass is a pre-application screening tool for international students on Australian temporary visas (Student visa **subclass 500** and Graduate visa **subclass 485**). It reads a job advertisement and returns one of three verdicts:

| Verdict | Meaning |
|---|---|
| **SKIP** | The ad contains a hard blocker, such as citizenship-only, permanent residency, security clearance, or "no sponsorship". |
| **TAILOR** | The role may be open to you, but something needs checking or addressing in your application (e.g. registration required, a visa plan requested, or temporary visa holders explicitly welcomed). |
| **APPLY** | No blocker language found in the ad. |

Every verdict comes with the **rule that fired** and the **exact text from the ad** that triggered it, so you can check the reasoning yourself.

**Live app:** https://hackathon-futura-remix.vercel.app

> **Not migration or legal advice.** JobCompass only reads the text you paste. It can't see an employer's separate screening questions or unwritten preferences, so always check those before applying.

## How it works

1. **Extract.** The ad text is sent to Google's Gemini API (`gemini-3.5-flash-lite`), which pulls out structured requirements: citizenship, residency, security clearance, sponsorship, work rights, registration, and so on. Each extracted field must quote the ad word for word. If the quoted text can't be found in the ad, the field is discarded ("no span, no claim"). Rule-based fallbacks in `src/lib/extractionFallbacks.ts` handle patterns the model misses or misclassifies.
2. **Decide.** The verdict is **not** decided by the LLM. A deterministic rules function (`evaluateJob` in `src/lib/rules.ts`) takes the extracted fields plus your visa profile (subclass, whether you're mid-study, months remaining) and returns SKIP, TAILOR or APPLY with a rule ID, a reason and the evidence span. The same input always gives the same verdict, so the logic is explainable and testable.
3. **Explain.** The result page highlights the evidence in the ad. Optional extras: tailoring advice for the application (`/api/tailor-advice`, also Gemini) and job suggestions (`/api/jobs/suggest`, via Adzuna).

## Features

- Verdict, rule ID and highlighted evidence for any pasted ad
- Visa profile matching for subclasses 500 and 485
- Tailoring advice for TAILOR verdicts
- Job suggestions
- Saved jobs and profile (stored in your browser only, up to 50 jobs)
- Feedback form (thumbs up/down, optional comment and email)
- Anonymous usage analytics (off unless configured)

## Evaluation

Rules were developed against a labelled set of real graduate and entry-level job ads, collected by hand because SEEK blocks automated fetching.

| Set | Location | Size | Notes |
|---|---|---|---|
| Dev set | `job_description_txt/dev_set/` | 35 ads | Used while building and tuning the rules |
| Hold-out | `job_description_txt/hold_out/` | 15 ads (5 SKIP, 5 TAILOR, 5 APPLY) | Kept separate from the dev set to check the rules generalise |

Ground-truth labels are hard-coded in the matching test files. The original hackathon prototype (a Python regex rules engine, `extraction_pipeline.py` + `tier_1_rules.yaml`) scored 19/19 on its first 19-ad set (`test_results.json`). That set was small and mostly SKIP cases, so treat it as a sanity check, not a measure of real-world accuracy.

Run the evaluations against a running app (they call the real `/api/extract`, so they use Gemini quota):

```bash
npm run dev                                   # in one terminal

RUN_CORPUS_EVAL=1 npm run test:run            # dev-set evaluation
RUN_HOLDOUT_EVAL=1 npm run test:run           # hold-out evaluation
```

Use `CORPUS_API_URL` or `HOLDOUT_API_URL` to point at a deployed instance. Set `EVAL_BYPASS_TOKEN` on both sides to skip per-client limits and the cache. The normal unit tests run with `npm run test:run`.

## Getting started

Requires Node.js and a Gemini API key.

```bash
npm install
echo "GEMINI_API_KEY=your-key-here" > .env.local   # see below for optional variables
npm run dev
```

Open http://localhost:3000.

Other scripts: `npm run build`, `npm run start`, `npm run lint`, `npm test` (watch mode).

### Environment variables

| Name | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Requirement extraction and tailoring advice. |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL` + `KV_REST_API_TOKEN`) | No | Redis for caching model output, rate limits and feedback storage. Without it, caching, rate limits and feedback storage are all skipped (fine for local development). |
| `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` | No | Job suggestions. |
| `NEXT_PUBLIC_POSTHOG_KEY` | No | PostHog project key. Unset means analytics is fully disabled. |
| `NEXT_PUBLIC_POSTHOG_HOST` | No | PostHog host (default `https://us.i.posthog.com`). |
| `RATE_LIMIT_PER_10_MIN`, `RATE_LIMIT_PER_DAY` | No | Per-client limits on analysis requests. |
| `FEEDBACK_RATE_LIMIT_PER_10_MIN`, `FEEDBACK_RATE_LIMIT_PER_DAY` | No | Per-client limits on feedback (defaults 5 and 20). |
| `GLOBAL_DAILY_GEMINI_CAP`, `GLOBAL_GEMINI_RPM_CAP` | No | Global caps on Gemini calls. |
| `RATE_LIMIT_SALT` | No | Salt for hashing client IPs in rate limiting. |
| `EVAL_BYPASS_TOKEN` | No | Lets evaluation runs skip per-client limits and the cache. |

## Privacy

- **Ad text** you submit is sent to Google's Gemini API for extraction. When Redis is configured, the raw model output is cached **without** the ad text.
- **Analytics** (PostHog) records only anonymous counts: weekly active users, ads analysed, verdict distribution, latency, cache hit rate and error rate. Job ad text, extracted text and anything typed by the user is never included. No autocapture, session recording or person profiles. Do Not Track and Global Privacy Control are respected. The allowed events and properties are whitelisted in `src/lib/analyticsSchema.ts`.
- **Saved jobs and profile** live in your browser's `localStorage` only and are never sent to the server or to analytics.
- **Feedback** comments and emails are stored in Redis (`feedback:v1`, newest first, max 500 entries, 90-day TTL) to improve the app. Only the thumbs up/down rating is sent to analytics. To have a submission deleted, email the address in the app footer (set in `CONTACT_EMAIL`, `src/lib/siteConfig.ts`).

Reading feedback in the Upstash console: `LRANGE feedback:v1 0 -1`. Each item is `{ id, at, rating, comment?, email? }`. Remove one with `LREM feedback:v1 1 '<exact item>'`, or all with `DEL feedback:v1`.

## Project structure

```
src/app/                 UI and API routes (/api/extract, /api/tailor-advice, /api/jobs/suggest, /api/feedback)
src/lib/rules.ts         Deterministic verdict logic
src/lib/extract*.ts      Gemini prompt, extraction fallbacks
src/lib/tests/           Unit tests and dev-set / hold-out evaluations
job_description_txt/     Hand-collected job ads (dev_set/, hold_out/)
extraction_pipeline.py   Original hackathon prototype (Python rules engine)
tier_1_rules.yaml        Rules for the prototype
test_harness.py          Prototype validation harness
PROJECT_HANDOFF.md       Notes written during the hackathon
```

## About

Built at the **MentorME Futura Remix Hackathon** (NSW round), 18–20 September 2026, by Nhi Tran, Anne Mai and Hong Quan Pham, and developed further afterwards.

Built with Next.js, TypeScript, Tailwind, the Gemini API, Upstash Redis, PostHog and Vercel.
