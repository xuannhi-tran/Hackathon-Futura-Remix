import {
  recommendJob,
  isEligibleForSubclass500,
  hasHardRecommendationBlocker,
  type RecommendationProfile,
} from "../../../../lib/jobRecommendation";
import { isAboveLevel, isEntryLevelProfile } from "../../../../lib/jobLevel";
import { getStateFullName } from "../../../../lib/location";

type AdzunaJob = {
  id: string;
  title: string;

  description?: string;

  redirect_url: string;

  created?: string;

  salary_min?: number;
  salary_max?: number;

  contract_type?: string;
  contract_time?: string;

  company?: {
    display_name?: string;
  };

  location?: {
    display_name?: string;
  };

  category?: {
    label?: string;
  };
};

type AdzunaResponse = {
  count?: number;
  results?: AdzunaJob[];
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Suggestions shown to the user. */
const DISPLAY_COUNT = 10;

/** Give up on the one optional extra request after this long. */
const EXTRA_REQUEST_TIMEOUT_MS = 8000;

// Level words for the 485 search of an entry-level profile. Sent as Adzuna's
// what_or (any of these words, in addition to the target field in what).
const ENTRY_LEVEL_WHAT_OR = "graduate junior entry associate trainee";

/** Build a single Adzuna search URL. */
function buildAdzunaUrl(
  appId: string,
  appKey: string,
  what: string,
  where: string,
  resultsPerPage: number,
  options: { page?: number; whatOr?: string } = {}
): string {
  const params = new URLSearchParams({
    app_id: appId,
    app_key: appKey,
    results_per_page: String(resultsPerPage),
    what,
    "content-type": "application/json",
  });
  if (where) params.set("where", where);
  if (options.whatOr) params.set("what_or", options.whatOr);
  return `https://api.adzuna.com/v1/api/jobs/au/search/${
    options.page ?? 1
  }?${params.toString()}`;
}

/** Merge job lists, keeping the first occurrence of each id. */
function mergeById(...lists: AdzunaJob[][]): AdzunaJob[] {
  const seen = new Set<string>();
  const merged: AdzunaJob[] = [];

  for (const list of lists) {
    for (const job of list) {
      if (!seen.has(job.id)) {
        seen.add(job.id);
        merged.push(job);
      }
    }
  }

  return merged;
}

/** Distinguishes Adzuna upstream failures (502) from internal errors (500). */
class AdzunaUpstreamError extends Error {
  constructor(status: number, body: string) {
    super(`Adzuna returned ${status}`);
    this.name = "AdzunaUpstreamError";
    console.error("Adzuna API error:", status, body);
  }
}

/** Fetch one Adzuna page and throw on HTTP failure (used for 485 primary query). */
async function fetchAdzunaPageStrict(url: string): Promise<{
  results: AdzunaJob[];
  count: number;
}> {
  const response = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.text();
    throw new AdzunaUpstreamError(response.status, body);
  }
  const data = (await response.json()) as AdzunaResponse;
  return { results: data.results ?? [], count: data.count ?? 0 };
}

/** Normalise an AdzunaJob to the shape the rest of the route uses. */
function normaliseJob(job: AdzunaJob) {
  return {
    id: job.id,
    title: job.title,
    company: job.company?.display_name ?? "Company not listed",
    location: job.location?.display_name ?? "Location not listed",
    description: job.description ?? "",
    redirectUrl: job.redirect_url,
    created: job.created,
    salaryMin: job.salary_min,
    salaryMax: job.salary_max,
    contractType: job.contract_type,
    contractTime: job.contract_time,
    category: job.category?.label,
  };
}

// ---------------------------------------------------------------------------
// Subclass-500 targeted retrieval
// ---------------------------------------------------------------------------

// Early-career qualifiers appended to the user's target field.  The result
// is a broader candidate pool that covers graduate / intern / junior / entry-level
// roles which would rarely appear in the first page of a generic field search.
// "entry level" is included because JUNIOR_TITLE_PATTERN already accepts it.
const SUBCLASS_500_QUALIFIERS = [
  "graduate",
  "intern",
  "junior",
  "entry level",
] as const;

const SUBCLASS_500_PAGE_SIZE = 10;

type QueryOutcome = { ok: true; jobs: AdzunaJob[] } | { ok: false };

/** Run a single targeted Adzuna search and return a typed outcome. */
async function runTargetedQuery(
  url: string,
  timeoutMs?: number
): Promise<QueryOutcome> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
    if (!response.ok) {
      const body = await response.text();
      console.error("Adzuna targeted query error:", response.status, body);
      return { ok: false };
    }
    const data = (await response.json()) as AdzunaResponse;
    return { ok: true, jobs: data.results ?? [] };
  } catch (err) {
    console.error("Adzuna targeted query threw:", err);
    return { ok: false };
  }
}

/**
 * Fire one Adzuna search per early-career qualifier in parallel.
 *
 * Returns:
 *  - `{ allFailed: true }` when every query returned an HTTP error (caller
 *    should surface a 502 to the client).
 *  - `{ allFailed: false, jobs }` when at least one query succeeded (even if
 *    it returned an empty page); `jobs` is the deduplicated merged pool.
 */
async function fetchSubclass500Candidates(
  appId: string,
  appKey: string,
  targetField: string,
  where: string
): Promise<
  | { allFailed: true }
  | {
      allFailed: false;
      jobs: AdzunaJob[];
      /** A qualifier whose page came back full, so a page 2 may exist. */
      fullPageQualifier?: string;
    }
> {
  const outcomes = await Promise.all(
    SUBCLASS_500_QUALIFIERS.map((qualifier) =>
      runTargetedQuery(
        buildAdzunaUrl(
          appId,
          appKey,
          `${targetField} ${qualifier}`,
          where,
          SUBCLASS_500_PAGE_SIZE
        )
      )
    )
  );

  if (outcomes.every((o) => !o.ok)) {
    return { allFailed: true };
  }

  const fullPageIndex = outcomes.findIndex(
    (outcome) => outcome.ok && outcome.jobs.length >= SUBCLASS_500_PAGE_SIZE
  );

  return {
    allFailed: false,
    jobs: mergeById(
      ...outcomes.map((outcome) => (outcome.ok ? outcome.jobs : []))
    ),
    fullPageQualifier:
      fullPageIndex === -1 ? undefined : SUBCLASS_500_QUALIFIERS[fullPageIndex],
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  try {
    const appId = process.env.ADZUNA_APP_ID;
    const appKey = process.env.ADZUNA_APP_KEY;

    if (!appId || !appKey) {
      return Response.json(
        { error: "Adzuna API credentials are not configured." },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);

    const what = (
      searchParams.get("targetField") ?? searchParams.get("what")
    )?.trim();
    const rawWhere =
      (
        searchParams.get("preferredLocation") ?? searchParams.get("where")
      )?.trim() ?? "";
    const adzunaWhere = rawWhere ? getStateFullName(rawWhere) : "";
    const subclass = searchParams.get("subclass");
    const studyTerm = searchParams.get("duringStudyTerm");
    const years = searchParams.get("yearsExperience");
    const months = searchParams.get("monthsRemaining");

    const nonNegative = (value: string | null) =>
      value !== null &&
      value.trim() !== "" &&
      Number.isFinite(Number(value)) &&
      Number(value) >= 0;

    if (
      !what ||
      !["500", "485"].includes(subclass ?? "") ||
      !["true", "false"].includes(studyTerm ?? "") ||
      !nonNegative(years) ||
      (months !== null && !nonNegative(months))
    ) {
      return Response.json(
        {
          error:
            "Provide targetField, subclass (500 or 485), duringStudyTerm (true or false), and non-negative yearsExperience and optional monthsRemaining.",
        },
        { status: 400 }
      );
    }

    const profile: RecommendationProfile = {
      subclass: subclass as "500" | "485",
      duringStudyTerm: studyTerm === "true",
      yearsExperience: Number(years),
      monthsRemaining: months === null ? undefined : Number(months),
      targetField: what,
      preferredLocation: rawWhere,
    };

    // -----------------------------------------------------------------------
    // Subclass 500 — targeted multi-query retrieval
    // -----------------------------------------------------------------------

    if (profile.subclass === "500") {
      const result = await fetchSubclass500Candidates(
        appId,
        appKey,
        what,
        adzunaWhere
      );

      if (result.allFailed) {
        return Response.json(
          { error: "Failed to retrieve jobs from Adzuna." },
          { status: 502 }
        );
      }

      const isSuggestable = (job: ReturnType<typeof normaliseJob>) =>
        !hasHardRecommendationBlocker(job) &&
        isEligibleForSubclass500(job.title) &&
        !isAboveLevel(job.title, job.description, profile.yearsExperience);

      let candidates = result.jobs;

      // Too few left after filtering: one more page of a query that came back
      // full, rather than padding with roles above the user's level. At most
      // one extra request; if it fails the first results are used as they are.
      if (
        result.fullPageQualifier &&
        candidates.map(normaliseJob).filter(isSuggestable).length <
          DISPLAY_COUNT
      ) {
        const extra = await runTargetedQuery(
          buildAdzunaUrl(
            appId,
            appKey,
            `${what} ${result.fullPageQualifier}`,
            adzunaWhere,
            SUBCLASS_500_PAGE_SIZE,
            { page: 2 }
          ),
          EXTRA_REQUEST_TIMEOUT_MS
        );

        if (extra.ok) candidates = mergeById(candidates, extra.jobs);
      }

      const jobs = candidates.map(normaliseJob);

      // Rank candidate pool
      const eligibleJobs = jobs.filter(isSuggestable);

      const rankedJobs = eligibleJobs
        .map((job) => ({ ...job, recommendation: recommendJob(job, profile) }))
        .sort(
          (a, b) =>
            b.recommendation.score - a.recommendation.score ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
        )
        .slice(0, DISPLAY_COUNT);

      return Response.json({
        query: {
          what,
          where: rawWhere || null,
          adzunaWhere: adzunaWhere || null,
        },
        // Report the deduplicated candidate pool size, not a raw Adzuna count
        // that would misrepresent the number of eligible recommendations.
        count: eligibleJobs.length,
        jobs: rankedJobs,
        candidateCount: jobs.length,
      });
    }

    // -----------------------------------------------------------------------
    // Subclass 485 — single query, widened at most once
    // -----------------------------------------------------------------------

    const SEARCH_PAGE_SIZE = 30;
    const entryLevel = isEntryLevelProfile(profile.yearsExperience);

    // Entry-level profiles ask Adzuna for level words up front, so managers and
    // consultants do not crowd out the first page.
    const url = buildAdzunaUrl(
      appId,
      appKey,
      what,
      adzunaWhere,
      SEARCH_PAGE_SIZE,
      entryLevel ? { whatOr: ENTRY_LEVEL_WHAT_OR } : {}
    );
    const { results: raw, count: adzunaCount } = await fetchAdzunaPageStrict(
      url
    );

    const isSuggestable = (job: ReturnType<typeof normaliseJob>) =>
      !hasHardRecommendationBlocker(job) &&
      !isAboveLevel(job.title, job.description, profile.yearsExperience);

    let candidates = raw;

    if (
      candidates.map(normaliseJob).filter(isSuggestable).length < DISPLAY_COUNT
    ) {
      // One extra request. A full first page means a page 2 exists; a short
      // page of the level-biased search is exhausted, so fall back to the plain
      // field search instead.
      const extraUrl =
        raw.length >= SEARCH_PAGE_SIZE
          ? buildAdzunaUrl(
              appId,
              appKey,
              what,
              adzunaWhere,
              SEARCH_PAGE_SIZE,
              entryLevel
                ? { page: 2, whatOr: ENTRY_LEVEL_WHAT_OR }
                : { page: 2 }
            )
          : entryLevel
          ? buildAdzunaUrl(appId, appKey, what, adzunaWhere, SEARCH_PAGE_SIZE)
          : null;

      if (extraUrl) {
        const extra = await runTargetedQuery(
          extraUrl,
          EXTRA_REQUEST_TIMEOUT_MS
        );

        if (extra.ok) candidates = mergeById(candidates, extra.jobs);
      }
    }

    const jobs = candidates.map(normaliseJob);
    const eligibleJobs = jobs.filter(isSuggestable);

    const rankedJobs = eligibleJobs
      .map((job) => ({ ...job, recommendation: recommendJob(job, profile) }))
      .sort(
        (a, b) =>
          b.recommendation.score - a.recommendation.score ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      )
      .slice(0, DISPLAY_COUNT);

    return Response.json({
      query: {
        what,
        where: rawWhere || null,
        adzunaWhere: adzunaWhere || null,
      },
      count: adzunaCount,
      jobs: rankedJobs,
      scoredCount: eligibleJobs.length,
    });
  } catch (error) {
    if (error instanceof AdzunaUpstreamError) {
      return Response.json(
        { error: "Failed to retrieve jobs from Adzuna." },
        { status: 502 }
      );
    }
    console.error("Job suggestion error:", error);
    return Response.json(
      { error: "Failed to retrieve suggested jobs." },
      { status: 500 }
    );
  }
}
