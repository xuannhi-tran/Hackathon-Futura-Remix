/**
 * The deterministic layer must not depend on what Gemini happens to extract.
 *
 * These tests drive the real POST /api/extract handler with a stubbed model
 * (no network): the stub returns either nothing or a deliberately wrong span,
 * and the verdict is then decided by evaluateJob as in production.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const stub = vi.hoisted(() => ({ response: {} as Record<string, unknown> }));

vi.mock("@google/genai", () => ({
  Type: { OBJECT: "OBJECT", STRING: "STRING" },
  GoogleGenAI: class {
    models = {
      generateContent: async () => ({ text: JSON.stringify(stub.response) }),
    };
  },
}));

import { POST } from "../../app/api/extract/route";
import { evaluateJob } from "../rules";

import type { ExtractedJobAd, VisaProfile } from "../../types/job";

const student500: VisaProfile = {
  subclass: "500",
  duringStudyTerm: true,
  monthsRemaining: 18,
};

const graduate485: VisaProfile = {
  subclass: "485",
  duringStudyTerm: false,
  monthsRemaining: 24,
};

async function extract(adText: string): Promise<ExtractedJobAd> {
  process.env.GEMINI_API_KEY = "test-key";

  const response = await POST(
    new Request("http://localhost/api/extract", {
      method: "POST",
      body: JSON.stringify({ adText }),
    })
  );

  expect(response.status).toBe(200);

  return ((await response.json()) as { extraction: ExtractedJobAd }).extraction;
}

function field(text: string) {
  return { value: "model", text };
}

beforeEach(() => {
  stub.response = {};
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. False SKIP: location / availability filed as permanent residency
// ─────────────────────────────────────────────────────────────────────────────

describe("residencyRequirement is validated against its own text", () => {
  const locationOnly: Array<{ adText: string; span: string }> = [
    {
      adText:
        "You must be residing in Australia and be available to commence full-time employment from January 2027",
      span: "residing in Australia",
    },
    { adText: "Candidates must reside in Australia.", span: "reside in Australia" },
    {
      adText: "You must be living in NSW at the time of application.",
      span: "living in NSW",
    },
  ];

  for (const c of locationOnly) {
    it(`drops a residency span that is only about location: ${c.span}`, async () => {
      stub.response = { residencyRequirement: field(c.span) };

      const job = await extract(c.adText);

      expect(job.residencyRequirement).toBeUndefined();

      for (const profile of [student500, graduate485]) {
        expect(evaluateJob(job, profile).status).not.toBe("SKIP");
      }
    });
  }

  it("keeps a residency span that names permanent residency", async () => {
    const adText = "Applicants must be permanent residents of Australia.";
    stub.response = { residencyRequirement: field("permanent residents") };

    const job = await extract(adText);

    expect(job.residencyRequirement?.text).toBe("permanent residents");
    expect(evaluateJob(job, student500).ruleId).toBe("T1_PERMANENT_RESIDENCY");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Missing span: the model returns nothing, the scan decides
// ─────────────────────────────────────────────────────────────────────────────

describe("model returns nothing — deterministic scan supplies the span", () => {
  it("citizen / PR OR Graduate Visa → TAILOR for both profiles", async () => {
    const adText =
      "Applicants must be a citizen of, or hold permanent residency in, Australia or New Zealand, or hold a Graduate Visa";

    const job = await extract(adText);

    expect(evaluateJob(job, graduate485).status).toBe("TAILOR");

    const v500 = evaluateJob(job, student500);
    expect(v500.status).toBe("TAILOR");
    expect(v500.ruleId).toBe("T2_GRADUATE_VISA_PATHWAY");
    expect(adText.slice(v500.evidence!.start, v500.evidence!.end)).toBe(
      v500.evidence!.text
    );
  });

  it("'permanent residents only' → SKIP", async () => {
    const job = await extract("Permanent residents only.");
    const verdict = evaluateJob(job, student500);

    expect(verdict.status).toBe("SKIP");
    expect(verdict.ruleId).toBe("T1_PERMANENT_RESIDENCY");
  });

  it("PR-only wording the fallbacks do not know → SKIP", async () => {
    const job = await extract(
      "This vacancy is open to permanent residents of Australia."
    );

    expect(evaluateJob(job, graduate485).ruleId).toBe(
      "T1_PERMANENT_RESIDENCY"
    );
  });

  it("citizen-only without must/required → SKIP", async () => {
    const job = await extract("Australian citizens only.");
    const verdict = evaluateJob(job, student500);

    expect(verdict.status).toBe("SKIP");
    expect(verdict.ruleId).toBe("T1_CITIZENSHIP");
  });

  it("status wording inside a bullet list → SKIP", async () => {
    const adText =
      "Eligibility:\n- Australian citizen\n- Permanent resident\n- Strong communication skills\n";
    const job = await extract(adText);

    expect(evaluateJob(job, graduate485).status).toBe("SKIP");
  });

  it("bullet list whose last option is a visa → TAILOR via the temporary-visa path", async () => {
    const adText =
      "To be considered you must be one of:\n- an Australian citizen\n- a New Zealand citizen\n- a holder of a valid work visa\n";
    const job = await extract(adText);

    for (const profile of [student500, graduate485]) {
      const verdict = evaluateJob(job, profile);
      expect(verdict.status).toBe("TAILOR");
      expect(verdict.ruleId).toBe("T2_TEMPORARY_VISA_ALLOWED");
    }
  });

  it("location-only wording with no model output stays APPLY", async () => {
    const job = await extract("You must be living in NSW at the time of application.");

    expect(evaluateJob(job, graduate485).status).toBe("APPLY");
  });

  describe("scan must not invent requirements", () => {
    const harmless = [
      "International graduates may transition to permanent residency once they have secured a 485 visa.",
      "Australian citizenship is not required for this role.",
      "We help our people with their permanent residency applications.",
      "Please provide proof of Australian citizenship or a birth certificate on day one.",
    ];

    for (const adText of harmless) {
      it(adText, async () => {
        const job = await extract(adText);

        expect(job.citizenshipRequirement).toBeUndefined();
        expect(job.residencyRequirement).toBeUndefined();
        expect(evaluateJob(job, graduate485).status).toBe("APPLY");
      });
    }
  });

  it("a valid model span is used as-is (scan does not override it)", async () => {
    const adText = "Applicants must be Australian citizens.";
    stub.response = { citizenshipRequirement: field("Australian citizens") };

    const job = await extract(adText);

    expect(job.citizenshipRequirement?.text).toBe("Australian citizens");
  });
});
