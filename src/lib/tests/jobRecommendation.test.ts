import { afterEach, describe, expect, it, vi } from "vitest";
import { recommendJob, type RecommendationProfile } from "../jobRecommendation";
import { GET } from "../../app/api/jobs/suggest/route";

const profile: RecommendationProfile = {
  subclass: "500", duringStudyTerm: true, monthsRemaining: 18,
  targetField: "Software Engineering", preferredLocation: "Sydney", yearsExperience: 0,
};
const job = { title: "Junior Software Engineer", location: "Sydney" };

describe("deterministic snippet recommendations", () => {
  it("awards the maximum for a matching junior role without asserting eligibility", () => {
    const result = recommendJob(job, profile);
    expect(result.score).toBe(100);
    expect(result).not.toHaveProperty("status");
    expect(result).not.toHaveProperty("verdict");
    expect(result.reasons).toHaveLength(4);
    expect(recommendJob(job, profile)).toEqual(result);
  });
  it.each(["Graduate", "Junior", "Entry-level", "Intern"])("ranks %s above unspecified experience", (level) => {
    expect(recommendJob({ ...job, title: `${level} Software Engineer` }, profile).score)
      .toBeGreaterThan(recommendJob({ ...job, title: "Software Engineer" }, profile).score);
  });
  it.each(["Senior", "Lead", "Principal", "Staff"])("strongly penalises %s for beginners", (level) => {
    const senior = { ...job, title: `${level} Software Engineer` };
    expect(recommendJob(senior, profile).score).toBe(50);
    expect(recommendJob(senior, { ...profile, yearsExperience: 6 }).score).toBe(100);
  });
  it("ignores incidental senior staff mentions", () => {
    expect(recommendJob({ ...job, description: "Work alongside senior staff" }, profile).score).toBe(100);
  });
  it("prefers title relevance over snippet-only relevance and unrelated roles", () => {
    const snippet = recommendJob({ title: "Consultant", description: "Software engineering", location: "Sydney" }, profile);
    expect(snippet.breakdown.role).toBe(30);
    expect(recommendJob(job, profile).breakdown.role).toBe(40);
    expect(recommendJob({ title: "Registered nurse" }, profile).breakdown.role).toBe(0);
  });
  it("prefers exact location, then whole-word regional matches", () => {
    expect(recommendJob(job, profile).breakdown.location).toBe(20);
    expect(recommendJob({ ...job, location: "Sydney, NSW" }, profile).breakdown.location).toBe(18);
    expect(recommendJob({ ...job, location: "Sydneyville" }, profile).breakdown.location).toBe(0);
    expect(recommendJob({ ...job, location: "Melbourne" }, profile).breakdown.location).toBe(0);
  });
  it.each(["Full-time", "38 hours per week", "20-30 hrs/week", "60 hours per fortnight"])("penalises study-term pattern: %s", (description) => {
    const full = { ...job, description };
    expect(recommendJob(full, profile).score).toBe(75);
    expect(recommendJob(full, { ...profile, subclass: "485" }).score).toBe(100);
    expect(recommendJob(full, { ...profile, duringStudyTerm: false }).score).toBe(100);
  });
  it("uses Adzuna contract metadata and leaves permanent 485 roles unpenalised", () => {
    const full = { ...job, contractTime: "full_time", contractType: "permanent" };
    expect(recommendJob(full, profile).score).toBe(75);
    expect(recommendJob(full, { ...profile, subclass: "485" }).penalties).toEqual([]);
  });
  it.each(["24 hours per week", "48 hours per fortnight", "part-time"])("does not deduct for %s", (description) => {
    expect(recommendJob({ ...job, description }, profile).score).toBe(100);
  });
  it.each(["Australian citizens only", "PR-only", "Permanent residents only", "Security-clearance required"])("strongly downranks restrictive snippet wording: %s", (description) => {
    for (const subclass of ["500", "485"] as const) {
      const result = recommendJob({ ...job, description }, { ...profile, subclass });
      expect(result.score).toBe(60);
      expect(result.penalties).toHaveLength(1);
    }
  });
  it.each([
    "full working rights", "unrestricted working rights", "full Australian work rights",
    "unrestricted Australian working rights", "work without restriction", "working without restriction",
  ])("penalises %s only for subclass 500 during study term", (description) => {
    const restricted = { ...job, description };
    const student = recommendJob(restricted, profile);
    expect(student.score).toBe(60);
    expect(student.penalties).toHaveLength(1);
    for (const subclass of ["500", "485"] as const) {
      for (const duringStudyTerm of [true, false]) {
        if (subclass === "500" && duringStudyTerm) continue;
        const result = recommendJob(restricted, { ...profile, subclass, duringStudyTerm });
        expect(result.score).toBe(100);
        expect(result.penalties).toEqual([]);
      }
    }
  });
  it("does not penalise combined full-time, permanent and work-right wording for 485", () => {
    const result = recommendJob({ ...job, contractTime: "full_time", contractType: "permanent",
      description: "Full working rights and unrestricted working rights required",
    }, { ...profile, subclass: "485" });
    expect(result.score).toBe(100);
    expect(result.penalties).toEqual([]);
  });
  it.each(["Australian citizens only", "Permanent residents only", "Security clearance required"])(
    "retains the 485 penalty for %s alongside unrestricted rights", (requirement) => {
      const result = recommendJob({ ...job, description: `${requirement}. Unrestricted working rights required.` },
        { ...profile, subclass: "485" });
      expect(result.score).toBe(60);
      expect(result.penalties).toHaveLength(1);
      expect(result.penalties[0]).not.toContain("Full or unrestricted");
    }
  );
  it("does not penalise generic legal work rights", () => {
    expect(recommendJob({ ...job, description: "Legally entitled to work in Australia" }, profile).penalties).toEqual([]);
  });
  it("uses explicit experience requirements over junior wording", () => {
    const experienced = { ...job, description: "3-5 years of experience" };
    expect(recommendJob(experienced, profile).score).toBe(65);
    expect(recommendJob(experienced, { ...profile, yearsExperience: 3 }).score).toBe(100);
  });
  it("compares explicit contract duration against months remaining", () => {
    expect(recommendJob({ ...job, description: "2-year contract" }, profile).score).toBe(85);
    expect(recommendJob({ ...job, description: "18 month contract" }, profile).score).toBe(100);
    expect(recommendJob({ ...job, description: "2-year contract" }, { ...profile, monthsRemaining: undefined }).score).toBe(100);
  });
  it.each(["500", "485"] as const)("keeps duration mismatch a soft ranking adjustment for %s", (subclass) => {
    const result = recommendJob({ ...job, description: "24 month contract" }, { ...profile, subclass });
    expect(result.score).toBe(85);
    expect(result.breakdown.penalty).toBe(15);
    expect(result.penalties).toEqual([
      "-15: Duration/profile mismatch: advertised contract duration exceeds your 18 months remaining. This is a soft ranking adjustment, not a determination of legal eligibility.",
    ]);
    expect(result).not.toHaveProperty("status");
    expect(result).not.toHaveProperty("verdict");
  });
  it("handles missing metadata and clamps accumulated penalties at zero", () => {
    expect(recommendJob({ title: "" }, { ...profile, preferredLocation: "" }).score).toBe(40);
    const result = recommendJob({ title: "Senior nurse", description: "Full-time. Australian citizens only. 10 years experience. 24 month contract" }, profile);
    expect(result.score).toBe(0);
    expect(result.penalties.length).toBeGreaterThan(2);
  });
});

describe("suggestions API", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  const request = (overrides: Record<string, string> = {}) => new Request(`http://localhost/api/jobs/suggest?${new URLSearchParams({
    subclass: "500", duringStudyTerm: "true", monthsRemaining: "18", targetField: "Software Engineering", preferredLocation: "Sydney", yearsExperience: "0", ...overrides,
  })}`);
  function setup(results: unknown[] = []) {
    vi.stubEnv("ADZUNA_APP_ID", "test-id");
    vi.stubEnv("ADZUNA_APP_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ count: 200, results }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  it("requests 30 candidates, ranks locally, and returns only the top 10", async () => {
    const fetchMock = setup(Array.from({ length: 30 }, (_, i) => ({
      id: String(i).padStart(2, "0"), title: i < 20 ? "Senior Software Engineer" : "Junior Software Engineer",
      location: { display_name: "Sydney" }, redirect_url: "https://example.com/job",
    })));
    const response = await GET(request());
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get("results_per_page")).toBe("30");
    expect(data.jobs).toHaveLength(10);
    expect(data.jobs.map((item: { id: string }) => item.id)).toEqual(Array.from({ length: 10 }, (_, i) => String(i + 20)));
    expect(data.jobs.every((item: { recommendation: { score: number } }) => item.recommendation.score === 100)).toBe(true);
    expect(data.scoredCount).toBe(30);
    expect(data.count).toBe(200);
  });
  it.each<Record<string, string>>([{ subclass: "999" }, { duringStudyTerm: "yes" }, { yearsExperience: "" }, { yearsExperience: "NaN" }, { monthsRemaining: "-1" }, { targetField: " " }])("rejects invalid profile %j", async (overrides) => {
    const fetchMock = setup();
    expect((await GET(request(overrides))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("passes the full profile into ranking", async () => {
    const results = [{ id: "1", title: "Junior Software Engineer", description: "24 month contract", contract_time: "full_time", location: { display_name: "Sydney" }, redirect_url: "https://example.com" }];
    setup(results);
    expect((await (await GET(request())).json()).jobs[0].recommendation.score).toBe(60);
    setup(results);
    expect((await (await GET(request({ subclass: "485", monthsRemaining: "24" }))).json()).jobs[0].recommendation.score).toBe(100);
  });
  it("returns an empty list for an empty Adzuna response", async () => {
    setup();
    expect((await (await GET(request())).json()).jobs).toEqual([]);
  });
  it("handles upstream failures", async () => {
    setup().mockResolvedValue(new Response("Unavailable", { status: 503 }));
    expect((await GET(request())).status).toBe(502);
  });
});
