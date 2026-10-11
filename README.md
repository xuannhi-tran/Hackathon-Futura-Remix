# JobCompass 🧭

**Paste a job ad. Find out in seconds whether your visa lets you apply, and see the exact sentence that decides it.**

JobCompass is a pre-application screening tool for international students in Australia on a **Student visa (subclass 500)** or **Graduate visa (subclass 485)**. It reads a job advertisement and returns one of three verdicts, each with the rule that fired and the exact text from the ad behind it.

**Live app:** https://jobcompass-au.vercel.app

> **Decision support, not migration or legal advice.** JobCompass only reads the text you paste. It cannot see an employer's separate screening questions, unwritten preferences or your full circumstances. Always check those before applying.

<img width="1902" height="950" alt="image" src="https://github.com/user-attachments/assets/fddf1eb1-69cb-4e99-b073-41d160b98ff0" />


## Verdicts

| Verdict | Meaning |
|---|---|
| **SKIP** | A hard blocker for your visa: Australian citizenship only, permanent residency only, a security clearance, or (for a subclass 500 in study term) full/unrestricted work rights or hours above the fortnightly limit. |
| **TAILOR** | The role may be open to you, but something needs checking or addressing: temporary or 485 visa holders explicitly welcomed, professional registration, a visa plan requested, "no sponsorship", Australian experience, permanent full-time (for 500), or generic work-rights wording. |
| **APPLY** | No visa blocker language found in the ad. This is not a guarantee: other requirements may still apply. |

## How it works

1. **Extract.** The ad text goes to Google's Gemini API (`gemini-3.5-flash-lite`, temperature 0), which only pulls out evidence: citizenship, residency, security clearance, sponsorship, work rights, registration and similar. Every extracted item must quote the ad word for word. If the quote cannot be found in the ad, it is discarded (**"no span, no claim"**). Rule-based fallbacks in `src/lib/extractionFallbacks.ts` cover patterns the model misses or misreads.
2. **Decide.** The verdict is **not** decided by the LLM. A deterministic function (`evaluateJob` in `src/lib/rules.ts`) takes the extracted evidence plus your visa profile (subclass, mid-study or not, months remaining) and returns SKIP, TAILOR or APPLY with a rule ID, a reason and the evidence span. Same input, same verdict: the logic is explainable and unit-tested.
3. **Explain.** The result highlights the evidence in the ad. Optional extras: application tailoring advice (`/api/tailor-advice`, Gemini) and job suggestions (`/api/jobs/suggest`, Adzuna).

Citizenship/PR clauses are split into their alternatives (citizen, PR, 485, any visa with work rights) and checked for negation in `extractionFallbacks.ts`, rather than matched as whole phrases. This is segment-based regex classification, not a full sentence parse; the verdict itself is decided in `rules.ts`. An earlier keyword-based version overfitted the dev set and failed a hold-out check. `evaluateJob` applies rules in a fixed precedence order: explicit temporary-visa acceptance, then 485 pathway, then hard blockers, then profile-aware work rights and hours, then conditional (TAILOR) rules.

Separately, `evaluateFitSignals` produces non-binding fit hints (experience, location, field). They help prioritise and never change the verdict.

## Features

- Verdict, rule ID and highlighted evidence for any pasted ad
- Profile-aware rules for subclasses 500 and 485
- Tailoring advice for TAILOR verdicts
- Job suggestions
- Saved jobs and profile, kept in your browser only (up to 50 jobs)
- Feedback widget (thumbs up/down, optional comment and email)
- Anonymous, opt-out-respecting usage analytics (off unless configured)

## Evaluation

Rules were developed against hand-collected real graduate and entry-level ads (SEEK blocks automated fetching).

| Set | Location | Size | Result |
|---|---|---|---|
| Dev set | `job_description_txt/dev_set/` | 35 ads | 35/35 |
| Hold-out | `job_description_txt/hold_out/` | 15 ads (5 SKIP, 5 TAILOR, 5 APPLY) | 14/15 (one known miss) |

**Read these numbers honestly.** The dev set was used to build and tune the rules, so 35/35 is not a generalisation measure. The hold-out was a true hold-out at first, but it exposed overfitting, I fixed the rules afterwards, and it is therefore now effectively a second dev set. A clean accuracy figure needs a fresh set labelled before running. That is planned, not done. The original hackathon prototype (`extraction_pipeline.py` + `tier_1_rules.yaml`) scored 19/19 on a small, mostly-SKIP set (`test_results.json`); treat that as a sanity check only.

Ground-truth labels live in the matching test files. The evaluations call the real `/api/extract`, so they use Gemini quota:

```bash
npm run dev                                   # terminal 1

RUN_CORPUS_EVAL=1 npm run test:run            # dev-set evaluation
RUN_HOLDOUT_EVAL=1 npm run test:run           # hold-out evaluation
```

Point at a deployed instance with `CORPUS_API_URL` / `HOLDOUT_API_URL` (full `/api/extract` URL). Set the same `EVAL_BYPASS_TOKEN` on both sides to skip per-client limits and the cache; keep requests spaced to stay under the Gemini rate cap.

## Getting started

Requires Node.js and a Gemini API key.

```bash
npm install
echo "GEMINI_API_KEY=your-key-here" > .env.local
npm run dev
```

Open http://localhost:3000.

Scripts: `npm run build`, `npm run start`, `npm run lint`, `npm test` (watch), `npm run test:run` (one-off).

### Environment variables

| Name | Required | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Requirement extraction and tailoring advice. |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (or `KV_REST_API_URL` + `KV_REST_API_TOKEN`) | No | Redis for caching, rate limits and feedback storage. Without it these are skipped (fine locally). If Redis errors at runtime, analysis fails open; feedback returns 503. |
| `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` | No | Job suggestions. |
| `NEXT_PUBLIC_POSTHOG_KEY` | No | PostHog project key. Unset disables analytics entirely. |
| `NEXT_PUBLIC_POSTHOG_HOST` | No | PostHog host (default `https://us.i.posthog.com`; match your project region). |
| `RATE_LIMIT_PER_10_MIN`, `RATE_LIMIT_PER_DAY` | No | Per-client limits on analysis (defaults 20 per 10 min, 60 per day). |
| `FEEDBACK_RATE_LIMIT_PER_10_MIN`, `FEEDBACK_RATE_LIMIT_PER_DAY` | No | Per-client feedback limits (defaults 5 and 20). |
| `GLOBAL_DAILY_GEMINI_CAP`, `GLOBAL_GEMINI_RPM_CAP` | No | Global Gemini call caps, to stay inside free-tier quota. |
| `RATE_LIMIT_SALT` | No | Salt for hashing client IPs. |
| `EVAL_BYPASS_TOKEN` | No | Lets evaluation runs (header `x-eval-token`) skip limits and cache. Keep it out of Production. |

Env vars on Vercel apply to new builds only: redeploy after changing them.

## Reliability and cost controls

- Raw model JSON is cached for 14 days, keyed on a hash of the normalised ad text and a cache version (not on your profile, so one analysis serves every profile).
- Per-client rate limits plus global daily and per-minute Gemini caps, with friendly messages for 429/503.
- `EXTRACT_CACHE_VERSION` in `src/lib/extractPrompt.ts` must be bumped when the prompt or fallbacks change.

## Privacy

- **Ad text** is sent to Google's Gemini API for extraction. The cache stores raw model output **without** the ad text.
- **Analytics** (PostHog) records only anonymous events: ads analysed, verdict, rule ID, visa subclass, cache hit, latency, ad-length bucket, saves, suggestion views, feedback rating, refusals. Never ad text, extracted text or anything you type. No autocapture, session replay or heatmaps. An anonymous random ID is kept in `localStorage`. Do Not Track and Global Privacy Control are respected. Allowed events and properties are whitelisted in `src/lib/analyticsSchema.ts`.
- **Saved jobs and profile** live in `localStorage` only and are never sent to the server or analytics.
- **Feedback** comments and emails are stored in Redis (`feedback:v1`, newest first, max 500, 90-day TTL). Only the rating goes to analytics. To have a submission deleted, email the address in the app footer (`CONTACT_EMAIL` in `src/lib/siteConfig.ts`).

Reading feedback in the Upstash console: `LRANGE feedback:v1 0 -1`. Items look like `{ id, at, rating, comment?, email? }`. Remove one with `LREM feedback:v1 1 '<exact item>'`, or all with `DEL feedback:v1`.

## Known limitations

- Reads only the pasted ad, so employer screening questions and unwritten preferences are invisible.
- Rules cover common phrasings; unusual wording can be missed. Work-rights wording is the weakest area (the one hold-out miss is an ad whose "must be residing in Australia" line was filed as a work-rights requirement, giving TAILOR instead of APPLY).
- Visa rules change. The rules reflect subclasses 500 and 485 as built, and are not updated automatically.
- Gemini free tier caps throughput; under heavy load users may see a "try again" message.
- Evaluation sets are small and hand-labelled (see above).

## Project structure

```
src/app/                 UI and API routes (/api/extract, /api/tailor-advice, /api/jobs/suggest, /api/feedback)
src/lib/rules.ts         Deterministic verdict logic (evaluateJob) and fit signals
src/lib/extractPrompt.ts Gemini prompt and cache version
src/lib/extractionFallbacks.ts  Rule-based fallbacks for the model
src/lib/geminiGuard.ts   Global Gemini caps
src/lib/redisClient.ts   Redis access (cache, rate limits, feedback)
src/lib/analytics*.ts    Whitelisted analytics
src/lib/localState.ts    Versioned localStorage persistence
src/lib/tests/           Unit tests and dev-set / hold-out evaluations
job_description_txt/     Hand-collected ads (dev_set/, hold_out/)
extraction_pipeline.py   Original hackathon prototype (Python rules engine)
tier_1_rules.yaml        Prototype rules
PROJECT_HANDOFF.md       Notes written during the hackathon
```

## About

Built at the **MentorME Futura Remix Hackathon** (NSW round), 18–20 September 2026, by Nhi Tran, Anne Mai and Hong Quan Pham, and developed further afterwards by Nhi.

Built with Next.js, TypeScript, Tailwind CSS, the Gemini API, Adzuna, Upstash Redis, PostHog and Vercel.
