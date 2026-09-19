import { describe, expect, it } from "vitest";

import { readFile, writeFile } from "node:fs/promises";

import path from "node:path";

import { evaluateJob } from "../rules";

import type { ExtractedJobAd, VisaProfile } from "../../types/job";

const RUN_CORPUS = process.env.RUN_CORPUS_EVAL === "1";

const API_URL =
  process.env.CORPUS_API_URL ?? "http://localhost:3000/api/extract";

const ADS_DIR = path.join(process.cwd(), "job_description_txt");

const GROUND_TRUTH: Record<string, "SKIP" | "TAILOR" | "APPLY"> = {
  "01_aps_data_stream.txt": "SKIP",
  "02_aps_stem_stream.txt": "SKIP",
  "03_aps_generalist_stream.txt": "SKIP",
  "04_dfat_graduate_program.txt": "SKIP",
  "05_nsw_health_senior_data_analyst.txt": "TAILOR",
  "06_aps4_participant_support_officer.txt": "SKIP",

  "10_rei_graduate_software_developer.txt": "SKIP",
  "11_arturia_ai_graduate_software_engineer.txt": "SKIP",
  "12_springtek_junior_software_engineer.txt": "SKIP",
  "13_sg_fleet_software_engineering_internship.txt": "SKIP",
  "14_lynxx_junior_backend_developer.txt": "SKIP",

  "15_caringbah_family_practice_rn.txt": "TAILOR",
  "16_healthscope_graduate_enrolled_nurse.txt": "TAILOR",
  "17_cabrini_health_graduate_rn.txt": "TAILOR",
  "18_innisfail_medical_centre_gp_nurse.txt": "TAILOR",

  "19_proforce_graduate_role.txt": "SKIP",
  "20_velocity_legal_graduate.txt": "APPLY",
  "21_qld_law_firm_graduate.txt": "SKIP",
  "23_service_stream_finance_graduate.txt": "SKIP",
};

const student500: VisaProfile = {
  subclass: "500",
  duringStudyTerm: true,
  monthsRemaining: 18,
};

type CorpusResult = {
  filename: string;
  expected: "SKIP" | "TAILOR" | "APPLY";
  predicted: "SKIP" | "TAILOR" | "APPLY";
  matched: boolean;
  ruleId?: string;
  reason: string;
  evidence?: string;
};

async function extractViaApp(adText: string): Promise<ExtractedJobAd> {
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(API_URL, {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
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

function createConfusionMatrix() {
  return {
    SKIP: {
      SKIP: 0,
      TAILOR: 0,
      APPLY: 0,
    },

    TAILOR: {
      SKIP: 0,
      TAILOR: 0,
      APPLY: 0,
    },

    APPLY: {
      SKIP: 0,
      TAILOR: 0,
      APPLY: 0,
    },
  };
}

describe.skipIf(!RUN_CORPUS)("19-ad corpus evaluation", () => {
  it("evaluates the deployed app logic against Quan's hand-labelled corpus", async () => {
    const results: CorpusResult[] = [];

    const filenames = Object.keys(GROUND_TRUTH);

    for (const filename of filenames) {
      const filePath = path.join(ADS_DIR, filename);

      const adText = await readFile(filePath, "utf8");

      const extraction = await extractViaApp(adText);

      const verdict = evaluateJob(extraction, student500);

      const expected = GROUND_TRUTH[filename];

      results.push({
        filename,

        expected,

        predicted: verdict.status,

        matched: verdict.status === expected,

        ruleId: verdict.ruleId,

        reason: verdict.reason,

        evidence: verdict.evidence?.text,
      });

      // Keep Gemini requests sequential and
      // slightly spaced to reduce rate-limit risk.
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    // ---------------------------------------
    // SUMMARY
    // ---------------------------------------

    const correct = results.filter((result) => result.matched).length;

    const total = results.length;

    const accuracy = total === 0 ? 0 : (correct / total) * 100;

    const mismatches = results.filter((result) => !result.matched);

    const matrix = createConfusionMatrix();

    for (const result of results) {
      matrix[result.expected][result.predicted] += 1;
    }

    // ---------------------------------------
    // CONSOLE REPORT
    // ---------------------------------------

    console.log("\n========================================");

    console.log("APP CORPUS EVALUATION");

    console.log("========================================");

    console.log(
      "Profile: subclass 500, during study term, 18 months remaining"
    );

    console.log(`API: ${API_URL}`);

    console.log(`Total: ${total}`);

    console.log(`Matches: ${correct}`);

    console.log(`Mismatches: ${mismatches.length}`);

    console.log(`Agreement: ${accuracy.toFixed(1)}%`);

    console.log("\nRESULTS");

    console.table(
      results.map((result) => ({
        file: result.filename,

        expected: result.expected,

        predicted: result.predicted,

        match: result.matched ? "YES" : "NO",

        rule: result.ruleId ?? "NONE",
      }))
    );

    console.log("\nCONFUSION MATRIX");

    console.table(matrix);

    if (mismatches.length > 0) {
      console.log("\nMISMATCHES");

      console.table(
        mismatches.map((result) => ({
          file: result.filename,

          expected: result.expected,

          predicted: result.predicted,

          rule: result.ruleId ?? "NONE",

          evidence: result.evidence ?? "NONE",
        }))
      );
    }

    // ---------------------------------------
    // EXPORT RESULT
    // ---------------------------------------

    const output = {
      evaluatedAt: new Date().toISOString(),

      profile: student500,

      apiUrl: API_URL,

      total,

      matches: correct,

      mismatches: mismatches.length,

      agreement: Number(accuracy.toFixed(1)),

      confusionMatrix: matrix,

      results,
    };

    await writeFile(
      path.join(process.cwd(), "corpus_app_results.json"),

      JSON.stringify(output, null, 2),

      "utf8"
    );

    // This evaluation should only fail
    // for infrastructure/data problems.
    //
    // It deliberately DOES NOT assert
    // 100% agreement because our app
    // has some intentionally contextual
    // verdict semantics that differ from
    // Quan's Python reference engine.
    expect(total).toBe(19);

    expect(results.every((result) => Boolean(result.predicted))).toBe(true);
  }, 240_000);
});
