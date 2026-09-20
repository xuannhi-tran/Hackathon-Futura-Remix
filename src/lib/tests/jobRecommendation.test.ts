import { afterEach, describe, expect, it, vi } from "vitest";
import { recommendJob, type RecommendationProfile } from "../jobRecommendation";
import { GET } from "../../app/api/jobs/suggest/route";

const profile: RecommendationProfile = {
  subclass: "500",
  duringStudyTerm: true,
  monthsRemaining: 18,
  targetField: "Software Engineering",
  preferredLocation: "NSW",
  yearsExperience: 0,
};
const job = { title: "Junior Software Engineer", location: "Sydney" };

describe("deterministic snippet recommendations", () => {
  it("returns ordered semantic signals without point arithmetic", () => {
    const result = recommendJob(
      {
        ...job,
        contractTime: "full_time",
        description:
          "Australian citizens only. 24 month contract. 5 years experience.",
      },
      profile
    );
    expect(result.signals.map(({ id }) => id)).toEqual([
      "profile",
      "role",
      "location",
      "experience",
      "duration",
    ]);
    expect(result.signals.map(({ tone }) => tone)).toEqual([
      "caution",
      "positive",
      "positive",
      "caution",
      "caution",
    ]);
    expect(result.signals[0].text).toContain("Work hours may also conflict");
    expect(
      result.signals.every(({ text }) => !/[+-]\d|\d+\/\d+/.test(text))
    ).toBe(true);
  });
  it("supplies neutral signals for missing experience and location preference", () => {
    const result = recommendJob(
      { title: "Software Engineer" },
      { ...profile, preferredLocation: "" }
    );
    expect(result.signals.find(({ id }) => id === "experience")).toMatchObject({
      tone: "neutral",
      text: "Experience requirement not specified",
    });
    expect(result.signals.find(({ id }) => id === "location")).toMatchObject({
      tone: "neutral",
    });
  });

  it("awards the maximum for a matching junior role without asserting eligibility", () => {
    const result = recommendJob(job, profile);
    expect(result.score).toBe(100);
    expect(result).not.toHaveProperty("status");
    expect(result).not.toHaveProperty("verdict");
    expect(result.reasons).toHaveLength(4);
    expect(recommendJob(job, profile)).toEqual(result);
  });
  it.each(["Graduate", "Junior", "Entry-level", "Intern"])(
    "ranks %s above unspecified experience",
    (level) => {
      expect(
        recommendJob({ ...job, title: `${level} Software Engineer` }, profile)
          .score
      ).toBeGreaterThan(
        recommendJob({ ...job, title: "Software Engineer" }, profile).score
      );
    }
  );
  it.each(["Senior", "Lead", "Principal", "Staff"])(
    "strongly penalises %s for beginners",
    (level) => {
      const senior = { ...job, title: `${level} Software Engineer` };
      expect(recommendJob(senior, profile).score).toBe(50);
      expect(
        recommendJob(senior, { ...profile, yearsExperience: 6 }).score
      ).toBe(100);
    }
  );
  it("ignores incidental senior staff mentions", () => {
    expect(
      recommendJob(
        { ...job, description: "Work alongside senior staff" },
        profile
      ).score
    ).toBe(100);
  });
  it("prefers title relevance over snippet-only relevance and unrelated roles", () => {
    const snippet = recommendJob(
      {
        title: "Consultant",
        description: "Software engineering",
        location: "Sydney",
      },
      profile
    );
    expect(snippet.breakdown.role).toBe(30);
    expect(recommendJob(job, profile).breakdown.role).toBe(40);
    expect(
      recommendJob({ title: "Registered nurse" }, profile).breakdown.role
    ).toBe(0);
  });
  it("matches state accurately", () => {
    const profileNSW = { ...profile, preferredLocation: "NSW" };
    expect(
      recommendJob({ ...job, location: "Sydney, NSW" }, profileNSW).breakdown
        .location
    ).toBe(20);
    expect(
      recommendJob(
        { ...job, location: "Newcastle, New South Wales" },
        profileNSW
      ).breakdown.location
    ).toBe(20);
    expect(
      recommendJob({ ...job, location: "Melbourne, VIC" }, profileNSW).breakdown
        .location
    ).toBe(0);

    const profileVIC = { ...profile, preferredLocation: "VIC" };
    expect(
      recommendJob({ ...job, location: "Geelong, Victoria" }, profileVIC)
        .breakdown.location
    ).toBe(20);

    // empty preference / Anywhere does not receive location mismatch (receives 10 points)
    expect(
      recommendJob(
        { ...job, location: "Melbourne" },
        { ...profile, preferredLocation: "" }
      ).breakdown.location
    ).toBe(10);
  });
  it.each([
    "Full-time",
    "38 hours per week",
    "20-30 hrs/week",
    "60 hours per fortnight",
  ])("penalises study-term pattern: %s", (description) => {
    const full = { ...job, description };
    expect(recommendJob(full, profile).score).toBe(75);
    expect(recommendJob(full, { ...profile, subclass: "485" }).score).toBe(100);
    expect(
      recommendJob(full, { ...profile, duringStudyTerm: false }).score
    ).toBe(100);
  });
  it("uses Adzuna contract metadata and leaves permanent 485 roles unpenalised", () => {
    const full = {
      ...job,
      contractTime: "full_time",
      contractType: "permanent",
    };
    expect(recommendJob(full, profile).score).toBe(75);
    expect(
      recommendJob(full, { ...profile, subclass: "485" }).penalties
    ).toEqual([]);
  });
  it.each(["24 hours per week", "48 hours per fortnight", "part-time"])(
    "does not deduct for %s",
    (description) => {
      expect(recommendJob({ ...job, description }, profile).score).toBe(100);
    }
  );
  it.each([
    "Australian citizens only",
    "PR-only",
    "Permanent residents only",
    "Security-clearance required",
  ])("strongly downranks restrictive snippet wording: %s", (description) => {
    for (const subclass of ["500", "485"] as const) {
      const result = recommendJob(
        { ...job, description },
        { ...profile, subclass }
      );
      expect(result.score).toBe(60);
      expect(result.penalties).toHaveLength(1);
    }
  });
  it.each([
    "full working rights",
    "unrestricted working rights",
    "full Australian work rights",
    "unrestricted Australian working rights",
    "work without restriction",
    "working without restriction",
  ])("penalises %s only for subclass 500 during study term", (description) => {
    const restricted = { ...job, description };
    const student = recommendJob(restricted, profile);
    expect(student.score).toBe(60);
    expect(student.penalties).toHaveLength(1);
    for (const subclass of ["500", "485"] as const) {
      for (const duringStudyTerm of [true, false]) {
        if (subclass === "500" && duringStudyTerm) continue;
        const result = recommendJob(restricted, {
          ...profile,
          subclass,
          duringStudyTerm,
        });
        expect(result.score).toBe(100);
        expect(result.penalties).toEqual([]);
      }
    }
  });
  it("does not penalise combined full-time, permanent and work-right wording for 485", () => {
    const result = recommendJob(
      {
        ...job,
        contractTime: "full_time",
        contractType: "permanent",
        description:
          "Full working rights and unrestricted working rights required",
      },
      { ...profile, subclass: "485" }
    );
    expect(result.score).toBe(100);
    expect(result.penalties).toEqual([]);
  });
  it.each([
    "Australian citizens only",
    "Permanent residents only",
    "Security clearance required",
  ])(
    "retains the 485 penalty for %s alongside unrestricted rights",
    (requirement) => {
      const result = recommendJob(
        {
          ...job,
          description: `${requirement}. Unrestricted working rights required.`,
        },
        { ...profile, subclass: "485" }
      );
      expect(result.score).toBe(60);
      expect(result.penalties).toHaveLength(1);
      expect(result.penalties[0]).not.toContain("Full or unrestricted");
    }
  );
  it("does not penalise generic legal work rights", () => {
    expect(
      recommendJob(
        { ...job, description: "Legally entitled to work in Australia" },
        profile
      ).penalties
    ).toEqual([]);
  });
  it("uses explicit experience requirements over junior wording", () => {
    const experienced = { ...job, description: "3-5 years of experience" };
    expect(recommendJob(experienced, profile).score).toBe(65);
    expect(
      recommendJob(experienced, { ...profile, yearsExperience: 3 }).score
    ).toBe(100);
  });
  it("compares explicit contract duration against months remaining", () => {
    expect(
      recommendJob({ ...job, description: "2-year contract" }, profile).score
    ).toBe(85);
    expect(
      recommendJob({ ...job, description: "18 month contract" }, profile).score
    ).toBe(100);
    expect(
      recommendJob(
        { ...job, description: "2-year contract" },
        { ...profile, monthsRemaining: undefined }
      ).score
    ).toBe(100);
  });
  it.each(["500", "485"] as const)(
    "keeps duration mismatch a soft ranking adjustment for %s",
    (subclass) => {
      const result = recommendJob(
        { ...job, description: "24 month contract" },
        { ...profile, subclass }
      );
      expect(result.score).toBe(85);
      expect(result.breakdown.penalty).toBe(15);
      expect(result.penalties).toEqual([
        "-15: Duration/profile mismatch: advertised contract duration exceeds your 18 months remaining. This is a soft ranking adjustment, not a determination of legal eligibility.",
      ]);
      expect(result).not.toHaveProperty("status");
      expect(result).not.toHaveProperty("verdict");
    }
  );
  it("handles missing metadata and clamps accumulated penalties at zero", () => {
    expect(
      recommendJob({ title: "" }, { ...profile, preferredLocation: "" }).score
    ).toBe(40);
    const result = recommendJob(
      {
        title: "Senior nurse",
        description:
          "Full-time. Australian citizens only. 10 years experience. 24 month contract",
      },
      profile
    );
    expect(result.score).toBe(0);
    expect(result.penalties.length).toBeGreaterThan(2);
  });
});

describe("suggestions API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const request = (overrides: Record<string, string> = {}) =>
    new Request(
      `http://localhost/api/jobs/suggest?${new URLSearchParams({
        subclass: "500",
        duringStudyTerm: "true",
        monthsRemaining: "18",
        targetField: "Software Engineering",
        preferredLocation: "NSW",
        yearsExperience: "0",
        ...overrides,
      })}`
    );

  function makeJob(
    overrides: Partial<{
      id: string;
      title: string;
      location: string;
      description: string;
    }> = {}
  ) {
    return {
      id: overrides.id ?? "1",
      title: overrides.title ?? "Junior Software Engineer",
      location: { display_name: overrides.location ?? "Sydney" },
      description: overrides.description ?? "",
      redirect_url: "https://example.com/job",
    };
  }

  /** Stub fetch for the subclass-485 single-query path. */
  function setup485(results: unknown[] = []) {
    vi.stubEnv("ADZUNA_APP_ID", "test-id");
    vi.stubEnv("ADZUNA_APP_KEY", "test-key");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ count: 200, results }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  /**
   * Stub fetch for the subclass-500 multi-query path.
   * pages[0] = graduate, pages[1] = intern, pages[2] = junior, pages[3] = entry level.
   */
  function setup500(pages: unknown[][] = [[], [], [], []]) {
    vi.stubEnv("ADZUNA_APP_ID", "test-id");
    vi.stubEnv("ADZUNA_APP_KEY", "test-key");
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      const page = pages[call] ?? [];
      call++;
      return Promise.resolve(
        Response.json({ count: page.length, results: page })
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  // ── Input validation ──────────────────────────────────────────────────────

  it.each<Record<string, string>>([
    { subclass: "999" },
    { duringStudyTerm: "yes" },
    { yearsExperience: "" },
    { yearsExperience: "NaN" },
    { monthsRemaining: "-1" },
    { targetField: " " },
  ])("rejects invalid profile %j", async (overrides) => {
    const fetchMock = setup485();
    expect((await GET(request(overrides))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ── A. Regression: generic first page has no junior roles ─────────────────
  // Old behaviour: one query for "Software Engineering" → 0 junior results →
  // isEligibleForSubclass500 filters all out → empty list returned.
  // New behaviour: three targeted queries find graduate/intern/junior roles.

  it("A: returns recommendations when generic search has no junior roles but targeted queries do", async () => {
    setup500([
      [makeJob({ id: "g1", title: "Graduate Software Engineer" })], // graduate query
      [makeJob({ id: "i1", title: "Software Engineering Intern" })], // intern query
      [makeJob({ id: "j1", title: "Junior Software Engineer" })], // junior query
      [], // entry level query
    ]);

    const response = await GET(request());
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.jobs.length).toBeGreaterThan(0);
    expect(
      data.jobs.every((j: { title: string }) =>
        /graduate|junior|jr|entry level|intern/i.test(j.title)
      )
    ).toBe(true);
  });

  // ── B. Deduplication ──────────────────────────────────────────────────────

  it("B: deduplicates a job returned by multiple targeted queries", async () => {
    const dup = makeJob({ id: "dup", title: "Junior Software Engineer" });
    setup500([[dup], [dup], [dup], [dup]]);

    const data = await (await GET(request())).json();
    expect(
      data.jobs.filter((j: { id: string }) => j.id === "dup")
    ).toHaveLength(1);
  });

  // ── C. Ineligible title filtered out even when returned by a targeted query

  it("C: filters out ineligible titles even when returned by a targeted query", async () => {
    setup500([
      [makeJob({ id: "s1", title: "Senior Software Engineer" })], // ineligible
      [makeJob({ id: "j1", title: "Junior Software Engineer" })], // eligible
      [],
      [],
    ]);

    const data = await (await GET(request())).json();
    const ids = data.jobs.map((j: { id: string }) => j.id);
    expect(ids).not.toContain("s1");
    expect(ids).toContain("j1");
  });

  // ── D. Graduate / Junior / Entry-level / Intern all retained ─────────────

  it.each([
    ["Graduate Software Engineer", "g1"],
    ["Junior Software Engineer", "j1"],
    ["Entry Level Software Engineer", "e1"],
    ["Software Engineering Intern", "i1"],
  ])("D: retains '%s'", async (title, id) => {
    setup500([[makeJob({ id, title })], [], [], []]);

    const data = await (await GET(request())).json();
    expect(data.jobs.some((j: { id: string }) => j.id === id)).toBe(true);
  });

  // ── E. Top-10 ranking across the merged pool ──────────────────────────────

  it("E: returns at most 10 ranked results from the merged candidate pool", async () => {
    const page = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) =>
        makeJob({ id: `${prefix}-${i}`, title: "Junior Software Engineer" })
      );

    setup500([page("g", 5), page("i", 5), page("j", 5), page("e", 5)]); // 20 unique eligible jobs

    const data = await (await GET(request())).json();
    expect(data.jobs).toHaveLength(10);
    expect(
      data.jobs.every(
        (j: { recommendation: { score: number } }) =>
          j.recommendation.score === 100
      )
    ).toBe(true);
  });

  // ── F. Subclass 485 — single query, no junior-title restriction ───────────

  it("F: subclass 485 uses a single Adzuna query and does not filter by title", async () => {
    const fetchMock = setup485([
      makeJob({ id: "s1", title: "Senior Software Engineer" }),
      makeJob({ id: "j1", title: "Junior Software Engineer" }),
    ]);

    const response = await GET(request({ subclass: "485" }));
    const data = await response.json();
    expect(response.status).toBe(200);

    // Exactly one network call (not three)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      new URL(fetchMock.mock.calls[0][0]).searchParams.get("results_per_page")
    ).toBe("30");

    // Senior role not filtered out for 485
    const ids = data.jobs.map((j: { id: string }) => j.id);
    expect(ids).toContain("s1");
    expect(ids).toContain("j1");
  });

  // ── Profile passed into scoring ───────────────────────────────────────────

  it("passes the full profile into ranking (485 path)", async () => {
    const results = [
      {
        id: "1",
        title: "Junior Software Engineer",
        description: "24 month contract",
        contract_time: "full_time",
        location: { display_name: "Sydney" },
        redirect_url: "https://example.com",
      },
    ];
    setup485(results);
    // 485, 18 months remaining → duration mismatch penalty −15; study-term penalty skipped for 485
    expect(
      (
        await (
          await GET(request({ subclass: "485", monthsRemaining: "18" }))
        ).json()
      ).jobs[0].recommendation.score
    ).toBe(85);
    setup485(results);
    // 485, 24 months remaining → no mismatch
    expect(
      (
        await (
          await GET(request({ subclass: "485", monthsRemaining: "24" }))
        ).json()
      ).jobs[0].recommendation.score
    ).toBe(100);
  });

  // ── Empty response ────────────────────────────────────────────────────────

  it("returns an empty list when all targeted searches return nothing", async () => {
    setup500([[], [], [], []]);
    expect((await (await GET(request())).json()).jobs).toEqual([]);
  });

  // ── Partial failure: one of the four 500 queries errors ──────────────────

  it("still returns results when one of the targeted queries fails", async () => {
    vi.stubEnv("ADZUNA_APP_ID", "test-id");
    vi.stubEnv("ADZUNA_APP_KEY", "test-key");
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        call++;
        if (call === 1)
          return Promise.resolve(new Response("Error", { status: 503 }));
        if (call === 2)
          return Promise.resolve(
            Response.json({
              results: [
                makeJob({ id: "ok", title: "Junior Software Engineer" }),
              ],
            })
          );
        return Promise.resolve(Response.json({ results: [] }));
      })
    );

    const data = await (await GET(request())).json();
    expect(data.jobs.some((j: { id: string }) => j.id === "ok")).toBe(true);
  });

  // ── All targeted 500 queries fail → 502 ──────────────────────────────────

  it("returns 502 when all subclass-500 targeted Adzuna requests fail", async () => {
    vi.stubEnv("ADZUNA_APP_ID", "test-id");
    vi.stubEnv("ADZUNA_APP_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Unavailable", { status: 503 }))
    );

    const response = await GET(request());
    expect(response.status).toBe(502);
    const data = await response.json();
    expect(data.error).toBeDefined();
  });

  // ── Upstream 502 — 485 strict path ───────────────────────────────────────

  it("handles upstream failures on 485 path", async () => {
    setup485().mockResolvedValue(new Response("Unavailable", { status: 503 }));
    expect((await GET(request({ subclass: "485" }))).status).toBe(502);
  });

  // ── Location `where` query tests ─────────────────────────────────────

  it("6. NSW maps to a state-level Adzuna `where` query", async () => {
    const fetchMock = setup485();
    const response = await GET(
      request({ subclass: "485", preferredLocation: "NSW" })
    );
    expect(response.status).toBe(200);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get("where")).toBe("New South Wales");
  });

  it("7. Anywhere omits the `where` parameter", async () => {
    const fetchMock = setup485();
    const response = await GET(
      request({ subclass: "485", preferredLocation: "" })
    );
    expect(response.status).toBe(200);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.has("where")).toBe(false);
  });

  it("8. subclass-500 targeted searches all retain the selected state", async () => {
    const fetchMock = setup500();
    const response = await GET(
      request({ subclass: "500", preferredLocation: "QLD" })
    );
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(4); // 4 queries for subclass 500
    for (const call of fetchMock.mock.calls) {
      const url = new URL(call[0]);
      expect(url.searchParams.get("where")).toBe("Queensland");
    }
  });

  it("9. subclass-485 search retains the selected state", async () => {
    const fetchMock = setup485();
    const response = await GET(
      request({ subclass: "485", preferredLocation: "VIC" })
    );
    expect(response.status).toBe(200);
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get("where")).toBe("Victoria");
  });
});
