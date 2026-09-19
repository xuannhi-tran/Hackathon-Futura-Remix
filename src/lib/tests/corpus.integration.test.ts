import { describe, expect, it } from "vitest";

import { readFile, writeFile } from "node:fs/promises";

import path from "node:path";

import { evaluateJob } from "../rules";

import type { ExtractedJobAd, VisaProfile } from "../../types/job";

const RUN_CORPUS = process.env.RUN_CORPUS_EVAL === "1";

const API_URL =
  process.env.CORPUS_API_URL ?? "http://localhost:3000/api/extract";

const ADS_DIR = path.join(process.cwd(), "job_description_txt", "dev_set");

const GROUND_TRUTH: Record<string, "SKIP" | "TAILOR" | "APPLY"> = {
  "01_aps_data_stream.txt": "SKIP",
  "02_am_logistics_graduate.txt": "APPLY",
  "03_aps_stem_stream.txt": "SKIP",
  "04_acciona_hr_graduate.txt": "SKIP",
  "05_aps_generalist_stream.txt": "SKIP",
  "06_dfat_graduate_program.txt": "SKIP",
  "07_gold_coast_data_analyst.txt": "SKIP",
  "08_grant_thornton_rd_tax_graduate.txt": "APPLY",
  "09_nsw_health_senior_data_analyst.txt": "TAILOR",
  "10_aps4_participant_support_officer.txt": "SKIP",
  "11_hne_registered_nurse_armidale.txt": "TAILOR",
  "12_ey_entry_level_service_delivery_analyst.txt": "SKIP",
  "13_pwc_junior_strategy_consultant.txt": "APPLY",
  "14_boeing_software_engineering_graduate.txt": "SKIP",
  "15_rei_graduate_software_developer.txt": "SKIP",
  "16_arturia_ai_graduate_software_engineer.txt": "TAILOR",
  "17_star_scaffolds_admin_assistant.txt": "APPLY",
  "18_sa_dtf_graduate_ict_cyber.txt": "TAILOR",
  "19_springtek_junior_software_engineer.txt": "SKIP",
  "20_mcgrathnicol_data_analytics_graduate.txt": "SKIP",
  "21_sg_fleet_software_engineering_internship.txt": "SKIP",
  "22_lynxx_junior_backend_developer.txt": "SKIP",
  "23_vll_partners_graduate_accountant.txt": "TAILOR",
  "24_caringbah_family_practice_rn.txt": "TAILOR",
  "25_tiktok_data_business_analyst_graduate.txt": "APPLY",
  "26_healthscope_graduate_enrolled_nurse.txt": "SKIP",
  "27_optiver_graduate_quantitative_researcher.txt": "SKIP",
  "28_cabrini_health_graduate_rn.txt": "SKIP",
  "29_innisfail_medical_centre_gp_nurse.txt": "TAILOR",
  "30_proforce_graduate_role.txt": "SKIP",
  "31_velocity_legal_graduate.txt": "APPLY",
  "32_qld_law_firm_graduate.txt": "SKIP",
  "33_service_stream_finance_graduate.txt": "SKIP",
  "34_mmem_business_management_graduate.txt": "SKIP",
  "35_urban_utilities_finance_graduate.txt": "SKIP",
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

function sanitizeAdTextForEvaluator(rawText: string): string {
  const lines = rawText.split(/\r?\n/);
  const sanitizedLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("**KEY SIGNAL")) {
      // Truncate the rest of the file
      break;
    }

    if (
      line.startsWith("**NO explicit") ||
      line.startsWith('**"9 day fortnight" is mentioned') ||
      line.startsWith("**Secondary note:")
    ) {
      // Skip this single line only
      continue;
    }

    sanitizedLines.push(line);
  }

  return sanitizedLines.join("\n").trim();
}

describe("sanitizeAdTextForEvaluator", () => {
  it("leaves real JD text unchanged", () => {
    const text = "This is a normal JD.\nIt requires full working rights.";
    expect(sanitizeAdTextForEvaluator(text)).toBe(text);
  });

  it("removes trailing KEY SIGNALS block", () => {
    const raw =
      "Genuine JD text.\n\n**KEY SIGNALS:\n1. Full working rights required";
    expect(sanitizeAdTextForEvaluator(raw)).toBe("Genuine JD text.");
  });

  it("removes NO explicit line followed by genuine JD content", () => {
    const raw =
      "Eligibility criteria:\n**NO explicit visa/citizenship requirement stated.**\nTertiary Qualification (EN or RN) with current AHPRA registration (required)";
    const expected =
      "Eligibility criteria:\nTertiary Qualification (EN or RN) with current AHPRA registration (required)";
    expect(sanitizeAdTextForEvaluator(raw)).toBe(expected);
  });

  it("phrases inside analyst notes cannot become eligibility evidence", () => {
    const raw = "Job Ad.\n**KEY SIGNALS: unrestricted working rights";
    const sanitized = sanitizeAdTextForEvaluator(raw);
    expect(sanitized.includes("unrestricted working rights")).toBe(false);
  });
});

describe.skipIf(!RUN_CORPUS)("35-ad dev-set corpus evaluation", () => {
  it("evaluates the deployed app logic against Quan's hand-labelled dev-set corpus", async () => {
    const results: CorpusResult[] = [];

    const filenames = Object.keys(GROUND_TRUTH);

    for (const filename of filenames) {
      const filePath = path.join(ADS_DIR, filename);

      const rawText = await readFile(filePath, "utf8");

      const adText = sanitizeAdTextForEvaluator(rawText);

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
      path.join(process.cwd(), "corpus_app_results_35.json"),

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
    expect(total).toBe(35);

    expect(results.every((result) => Boolean(result.predicted))).toBe(true);
  }, 420_000);
});
