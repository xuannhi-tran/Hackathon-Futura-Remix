import { describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { evaluateJob } from "../rules";
import type { ExtractedJobAd, VisaProfile } from "../../types/job";

/**
 * Frozen, pre-labelled fresh evaluation set (job_description_txt/fresh/).
 *
 * This is a MEASUREMENT, not a regression gate: it never fails because of
 * misses. It fails only on infrastructure problems (HTTP failure after
 * retries, missing files, malformed labels.json). Each ad is run exactly once;
 * there is no auto-retry on a mismatch.
 *
 * Run: RUN_FRESH_EVAL=1 (see the command in the task notes). Skipped otherwise.
 */

const RUN_FRESH = process.env.RUN_FRESH_EVAL === "1";

const API_URL =
  process.env.FRESH_API_URL ??
  process.env.CORPUS_API_URL ??
  "http://localhost:3000/api/extract";

const FRESH_DIR = path.join(process.cwd(), "job_description_txt", "fresh");
const LABELS_PATH = path.join(FRESH_DIR, "labels.json");
const RESULTS_PATH = "fresh_app_results_22.json";

const VERDICTS = ["APPLY", "SKIP", "TAILOR"] as const;
type VerdictStatus = (typeof VERDICTS)[number];

type Limitation = { by_rules: VerdictStatus; by_human: VerdictStatus };

type FreshLabels = {
  profile: VisaProfile;
  scored: Record<string, VerdictStatus>;
  limitations: Record<string, Limitation>;
};

// The fields that feed the decision, recorded for every ad so each miss can be
// classified afterwards as an extraction, rule or label problem.
const DECISION_FIELDS = [
  "citizenshipRequirement",
  "residencyRequirement",
  "securityClearance",
  "workRightsRequirement",
  "temporaryVisaAllowed",
  "graduateVisaPathway",
  "visaPlanRequirement",
  "sponsorship",
  "employmentType",
  "hoursPerWeek",
  "registration",
  "australianExperienceRequirement",
] as const;

type FieldSnapshot = Record<string, { text: string; value: string } | null> & {
  title: string | null;
};

type FreshResult = {
  filename: string;
  expected: VerdictStatus;
  predicted: VerdictStatus;
  matched: boolean;
  ruleId?: string;
  reason: string;
  evidence?: string;
  fields: FieldSnapshot;
};

type LimitationResult = {
  filename: string;
  expectedByRules: VerdictStatus;
  expectedByHuman: VerdictStatus;
  predicted: VerdictStatus;
  agreesWithRules: boolean;
  agreesWithHuman: boolean;
  ruleId?: string;
  reason: string;
  evidence?: string;
  fields: FieldSnapshot;
};

function isVerdict(value: unknown): value is VerdictStatus {
  return typeof value === "string" && (VERDICTS as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads labels.json and throws on anything malformed (an infrastructure error). */
async function loadLabels(): Promise<FreshLabels> {
  let raw: unknown;

  try {
    raw = JSON.parse(await readFile(LABELS_PATH, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${LABELS_PATH}: ${(error as Error).message}`);
  }

  if (!isRecord(raw)) throw new Error("labels.json must be an object.");

  const { profile, scored, known_limitations_not_scored: limitations } = raw;

  if (
    !isRecord(profile) ||
    (profile.subclass !== "500" && profile.subclass !== "485") ||
    typeof profile.duringStudyTerm !== "boolean" ||
    (profile.monthsRemaining !== undefined &&
      typeof profile.monthsRemaining !== "number")
  ) {
    throw new Error("labels.json: invalid or missing 'profile'.");
  }

  if (!isRecord(scored) || Object.keys(scored).length === 0) {
    throw new Error("labels.json: 'scored' must be a non-empty object.");
  }

  for (const [file, label] of Object.entries(scored)) {
    if (!isVerdict(label)) {
      throw new Error(`labels.json: invalid label for ${file}: ${String(label)}`);
    }
  }

  if (!isRecord(limitations)) {
    throw new Error("labels.json: 'known_limitations_not_scored' must be an object.");
  }

  for (const [file, entry] of Object.entries(limitations)) {
    if (!isRecord(entry) || !isVerdict(entry.by_rules) || !isVerdict(entry.by_human)) {
      throw new Error(`labels.json: invalid limitation entry for ${file}.`);
    }
  }

  return {
    profile: profile as unknown as VisaProfile,
    scored: scored as Record<string, VerdictStatus>,
    limitations: limitations as Record<string, Limitation>,
  };
}

async function extractViaApp(adText: string): Promise<ExtractedJobAd> {
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Skips the per-client limit and the cache when the server has the
          // same EVAL_BYPASS_TOKEN. Global Gemini caps still apply.
          ...(process.env.EVAL_BYPASS_TOKEN
            ? { "x-eval-token": process.env.EVAL_BYPASS_TOKEN }
            : {}),
        },
        body: JSON.stringify({
          adText,
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          extraction?: ExtractedJobAd;
        };

        if (!data.extraction) {
          throw new Error("Extraction API returned no extraction object.");
        }

        return data.extraction;
      }

      const body = await response.text();
      const retryable = response.status === 429 || response.status >= 500;

      if (!retryable || attempt === maxAttempts) {
        throw new Error(`Extraction API failed (${response.status}): ${body}`);
      }

      const delayMs = 25000;
      console.warn(
        `Extraction attempt ${attempt}/${maxAttempts} failed with ${response.status}. Retrying in ${delayMs}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }

      const delayMs = 1000 * 2 ** (attempt - 1);
      console.warn(
        `Extraction attempt ${attempt}/${maxAttempts} failed. Retrying in ${delayMs}ms...`
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error("Extraction failed after all retry attempts.");
}

function snapshotFields(extraction: ExtractedJobAd): FieldSnapshot {
  const snapshot = { title: extraction.title ?? null } as FieldSnapshot;

  for (const name of DECISION_FIELDS) {
    const field = extraction[name];

    snapshot[name] = field ? { text: field.text, value: field.value } : null;
  }

  return snapshot;
}

function emptyMatrix() {
  const row = () => ({ APPLY: 0, SKIP: 0, TAILOR: 0 });

  return { APPLY: row(), SKIP: row(), TAILOR: row() };
}

async function evaluate(filename: string, profile: VisaProfile) {
  const adText = await readFile(path.join(FRESH_DIR, filename), "utf8");
  const extraction = await extractViaApp(adText);
  const verdict = evaluateJob(extraction, profile);

  return {
    verdict,
    fields: snapshotFields(extraction),
  };
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 5000));

describe.skipIf(!RUN_FRESH)("22-ad fresh evaluation (20 scored + 2 known limitations)", () => {
  it("measures the deployed app against the frozen fresh set", async () => {
    const labels = await loadLabels();
    const scoredFiles = Object.keys(labels.scored);
    const limitationFiles = Object.keys(labels.limitations);

    // -----------------------
    // Scored set (one run per ad, sequential to respect rate limits)
    // -----------------------

    const results: FreshResult[] = [];

    for (const filename of scoredFiles) {
      const { verdict, fields } = await evaluate(filename, labels.profile);
      const expected = labels.scored[filename];

      results.push({
        filename,
        expected,
        predicted: verdict.status,
        matched: verdict.status === expected,
        ruleId: verdict.ruleId,
        reason: verdict.reason,
        evidence: verdict.evidence?.text,
        fields,
      });

      await pause();
    }

    // -----------------------
    // Known limitations (reported separately, never scored)
    // -----------------------

    const limitationResults: LimitationResult[] = [];

    for (const filename of limitationFiles) {
      const { verdict, fields } = await evaluate(filename, labels.profile);
      const entry = labels.limitations[filename];

      limitationResults.push({
        filename,
        expectedByRules: entry.by_rules,
        expectedByHuman: entry.by_human,
        predicted: verdict.status,
        agreesWithRules: verdict.status === entry.by_rules,
        agreesWithHuman: verdict.status === entry.by_human,
        ruleId: verdict.ruleId,
        reason: verdict.reason,
        evidence: verdict.evidence?.text,
        fields,
      });

      await pause();
    }

    // -----------------------
    // Scoring
    // -----------------------

    const total = results.length;
    const correct = results.filter((r) => r.matched).length;
    const accuracy = total === 0 ? 0 : (correct / total) * 100;
    const misses = results.filter((r) => !r.matched);
    const matrix = emptyMatrix();

    for (const result of results) {
      matrix[result.expected][result.predicted] += 1;
    }

    // Class sizes come from labels.json, not from constants.
    const perClass = Object.fromEntries(
      VERDICTS.map((cls) => {
        const ofClass = results.filter((r) => r.expected === cls);

        return [
          cls,
          { correct: ofClass.filter((r) => r.matched).length, total: ofClass.length },
        ];
      })
    ) as Record<VerdictStatus, { correct: number; total: number }>;

    // -----------------------
    // Console report
    // -----------------------

    console.log("\n========================================");
    console.log("FRESH SET EVALUATION (measurement, not a gate)");
    console.log("========================================");
    console.log(
      `Profile: subclass ${labels.profile.subclass}, ` +
        `${labels.profile.duringStudyTerm ? "during" : "outside"} study term, ` +
        `${labels.profile.monthsRemaining ?? "n/a"} months remaining`
    );
    console.log(`API: ${API_URL}`);
    console.log(`\nOVERALL: ${correct}/${total} (${accuracy.toFixed(1)}%)`);
    console.log(
      "PER CLASS: " +
        VERDICTS.map((c) => `${c} ${perClass[c].correct}/${perClass[c].total}`).join(", ")
    );

    console.log("\nRESULTS");
    console.table(
      results.map((r) => ({
        file: r.filename,
        expected: r.expected,
        predicted: r.predicted,
        match: r.matched ? "YES" : "NO",
        rule: r.ruleId ?? "NONE",
      }))
    );

    console.log("\nCONFUSION MATRIX (Row = Expected, Col = Predicted)");
    console.table(matrix);

    if (misses.length > 0) {
      console.log(`\nMISSES (${misses.length})`);

      for (const miss of misses) {
        console.log(
          `\n- ${miss.filename}\n` +
            `  expected:  ${miss.expected}\n` +
            `  predicted: ${miss.predicted}\n` +
            `  ruleId:    ${miss.ruleId ?? "NONE"}\n` +
            `  reason:    ${miss.reason}\n` +
            `  evidence:  ${miss.evidence ? JSON.stringify(miss.evidence) : "NONE"}\n` +
            `  extracted: ${JSON.stringify(
              Object.fromEntries(
                Object.entries(miss.fields)
                  .filter(([, value]) => value !== null)
                  .map(([key, value]) => [
                    key,
                    typeof value === "string" ? value : (value as { text: string }).text,
                  ])
              )
            )}`
        );
      }
    }

    console.log("\n========================================");
    console.log("KNOWN LIMITATIONS (not scored)");
    console.log("========================================");
    console.table(
      limitationResults.map((r) => ({
        file: r.filename,
        "expected by rules": r.expectedByRules,
        "expected by human": r.expectedByHuman,
        predicted: r.predicted,
        rule: r.ruleId ?? "NONE",
      }))
    );

    // -----------------------
    // JSON results (git-ignored)
    // -----------------------

    await writeFile(
      RESULTS_PATH,
      JSON.stringify(
        {
          evaluatedAt: new Date().toISOString(),
          profile: labels.profile,
          apiUrl: API_URL,
          summary: { total, correct, accuracy, perClass },
          matrix,
          misses,
          results,
          knownLimitations: {
            note: "Reported separately; not counted in the score.",
            results: limitationResults,
          },
        },
        null,
        2
      )
    );

    console.log(`\nResults written to ${RESULTS_PATH}`);

    // -----------------------
    // Assertions: infrastructure only. Misses never fail this test.
    // -----------------------

    expect(total).toBe(scoredFiles.length);
    expect(limitationResults).toHaveLength(limitationFiles.length);
  }, 900_000);
});
