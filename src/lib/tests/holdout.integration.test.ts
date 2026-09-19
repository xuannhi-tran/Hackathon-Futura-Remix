import { describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { evaluateJob } from "../rules";
import type { ExtractedJobAd, VisaProfile } from "../../types/job";

const RUN_HOLDOUT = process.env.RUN_HOLDOUT_EVAL === "1";

const API_URL =
  process.env.HOLDOUT_API_URL ??
  process.env.CORPUS_API_URL ??
  "http://localhost:3000/api/extract";

const ADS_DIR = path.join(process.cwd(), "job_description_txt", "hold_out");

const GROUND_TRUTH: Record<string, "SKIP" | "TAILOR" | "APPLY"> = {
  // SKIP — 5
  "24_asx_technology_division_graduate.txt": "SKIP",
  "25_mmem_business_management_graduate_melbourne.txt": "SKIP",
  "26_mcgrathnicol_cyber_graduate_melbourne_sydney.txt": "SKIP",
  "27_ausgrid_electrical_engineering_graduate.txt": "SKIP",
  "28_kmart_supply_chain_graduate.txt": "SKIP",

  // TAILOR — 5
  "29_sw_assurance_advisory_graduate.txt": "TAILOR",
  "30_nt_treasury_finance_graduate.txt": "TAILOR",
  "31_ventia_sheq_graduate.txt": "TAILOR",
  "32_everyday_independence_graduate_occupational_therapist.txt": "TAILOR",
  "33_turner_townsend_infrastructure_graduate.txt": "TAILOR",

  // APPLY — 5
  "34_tiktok_backend_software_engineer_multimedia_platform_graduate.txt":
    "APPLY",
  "35_citadel_securities_quantitative_trading_full_time.txt": "APPLY",
  "36_tiktok_live_foundation_backend_software_engineer_graduate.txt": "APPLY",
  "37_gamuda_engineering_graduate_program.txt": "APPLY",
  "38_kpmg_business_consulting_risk_graduate.txt": "APPLY",
};

const student500: VisaProfile = {
  subclass: "500",
  duringStudyTerm: true,
  monthsRemaining: 18,
};

type HoldoutResult = {
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
    SKIP: { SKIP: 0, TAILOR: 0, APPLY: 0 },
    TAILOR: { SKIP: 0, TAILOR: 0, APPLY: 0 },
    APPLY: { SKIP: 0, TAILOR: 0, APPLY: 0 },
  };
}

describe.skipIf(!RUN_HOLDOUT)("15-ad final hold-out evaluation", () => {
  it("evaluates the deployed app logic against the unseen 15-ad hold-out corpus", async () => {
    const results: HoldoutResult[] = [];
    const filenames = Object.keys(GROUND_TRUTH);

    for (const filename of filenames) {
      const filePath = path.join(ADS_DIR, filename);

      // No annotations in hold-out set, read plain file
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

      // Sequential delay to respect rate limits
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    const correct = results.filter((result) => result.matched).length;
    const total = results.length;
    const accuracy = total === 0 ? 0 : (correct / total) * 100;
    const mismatches = results.filter((result) => !result.matched);
    const matrix = createConfusionMatrix();

    for (const result of results) {
      matrix[result.expected][result.predicted] += 1;
    }

    console.log("\n========================================");
    console.log("APP HOLD-OUT EVALUATION");
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

    console.log("\nCONFUSION MATRIX (Row = Expected, Col = Predicted)");
    console.table(matrix);

    if (mismatches.length > 0) {
      console.log("\nMISMATCHES");
      console.table(
        mismatches.map((m) => ({
          file: m.filename,
          expected: m.expected,
          predicted: m.predicted,
          rule: m.ruleId ?? "NONE",
          evidence: m.evidence ? m.evidence.substring(0, 40) + "..." : "NONE",
        }))
      );
    }

    await writeFile(
      "holdout_app_results_15.json",
      JSON.stringify(
        {
          summary: {
            total,
            correct,
            accuracy,
          },
          matrix,
          results,
        },
        null,
        2
      )
    );

    // Test Assertions
    expect(total).toBe(15);
    for (const result of results) {
      expect(result.predicted).toBeDefined();
    }
  }, 420_000); // Generous timeout
});
