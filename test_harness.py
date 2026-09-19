#!/usr/bin/env python3
"""
Test Harness for Tier 1 Extraction Pipeline — DEV SET (35 ads)

Merges:
  - 19 ads with ground truth carried over from the original 20-ad corpus
    (test_harness.py GROUND_TRUTH), renumbered to match the dev set's
    project filenames.
  - 16 new ads collected this session, labeled per the proposed reading
    the team confirmed (see chat: "Final call will be follow your
    proposed reading").

Ambiguous calls made explicit here (team-confirmed):
  - 11_hne_registered_nurse_armidale.txt -> Tailor (AHPRA conditional +
    temp-visa-tied-to-expiry; Transition-pathway sponsorship exclusion
    is scoped, not ad-wide)
  - 18_sa_dtf_graduate_ict_cyber.txt -> Tailor (soft "visa with
    acceptable work conditions" + explicit welcome of international
    students; not silent, not a hard blocker)
  - 23_vll_partners_graduate_accountant.txt -> Tailor ("valid Australian
    work rights" read as closer to the vague/conditional working-rights
    pattern than the hard "full working rights" pattern)
  - 27_optiver_graduate_quantitative_researcher.txt -> Tailor
    (citizen/PR/"or full working rights" — third option opens the door
    to visa holders, same shape as the existing NSW Health Tailor case)
  - 35_urban_utilities_finance_graduate.txt -> Tailor (same
    citizen-or-unrestricted-rights structure as Optiver)
"""

import json
import sys
from extraction_pipeline import Tier1RulesEngine, ExtractionResult
from pathlib import Path

GROUND_TRUTH_DEV = {
    # --- 19 ads carried over from the original 20-ad corpus ---
    "01_aps_data_stream.txt": "Skip",
    "03_aps_stem_stream.txt": "Skip",
    "05_aps_generalist_stream.txt": "Skip",
    "06_dfat_graduate_program.txt": "Skip",
    "09_nsw_health_senior_data_analyst.txt": "Tailor",
    "10_aps4_participant_support_officer.txt": "Skip",
    "15_rei_graduate_software_developer.txt": "Skip",
    "16_arturia_ai_graduate_software_engineer.txt": "Skip",
    "19_springtek_junior_software_engineer.txt": "Skip",
    "21_sg_fleet_software_engineering_internship.txt": "Skip",
    "22_lynxx_junior_backend_developer.txt": "Skip",
    "24_caringbah_family_practice_rn.txt": "Tailor",
    "26_healthscope_graduate_enrolled_nurse.txt": "Tailor",
    "28_cabrini_health_graduate_rn.txt": "Tailor",
    "29_innisfail_medical_centre_gp_nurse.txt": "Tailor",
    "30_proforce_graduate_role.txt": "Skip",
    "31_velocity_legal_graduate.txt": "Apply",
    "32_qld_law_firm_graduate.txt": "Skip",
    "33_service_stream_finance_graduate.txt": "Skip",

    # --- 16 new ads collected this session ---
    "02_am_logistics_graduate.txt": "Apply",
    "04_acciona_hr_graduate.txt": "Skip",
    "07_gold_coast_data_analyst.txt": "Skip",
    "08_grant_thornton_rd_tax_graduate.txt": "Apply",
    "11_hne_registered_nurse_armidale.txt": "Tailor",
    "12_ey_entry_level_service_delivery_analyst.txt": "Skip",
    "13_pwc_junior_strategy_consultant.txt": "Apply",
    "14_boeing_software_engineering_graduate.txt": "Skip",
    "17_star_scaffolds_admin_assistant.txt": "Apply",
    "18_sa_dtf_graduate_ict_cyber.txt": "Tailor",
    "20_mcgrathnicol_data_analytics_graduate.txt": "Skip",
    "23_vll_partners_graduate_accountant.txt": "Tailor",
    "25_tiktok_data_business_analyst_graduate.txt": "Apply",
    "27_optiver_graduate_quantitative_researcher.txt": "Tailor",
    "34_mmem_business_management_graduate.txt": "Skip",
    "35_urban_utilities_finance_graduate.txt": "Tailor",
}


class TestHarness:
    """Run extraction pipeline on dev-set ads and compare to ground truth."""

    def __init__(self, rules_file: str, ads_dir: str):
        self.engine = Tier1RulesEngine(rules_file)
        self.ads_dir = Path(ads_dir)
        self.results = []
        self.confusion_matrix = {
            "Skip": {"Skip": 0, "Tailor": 0, "Apply": 0},
            "Tailor": {"Skip": 0, "Tailor": 0, "Apply": 0},
            "Apply": {"Skip": 0, "Tailor": 0, "Apply": 0},
        }

    def run_test(self, ad_filename: str) -> dict:
        ad_path = self.ads_dir / ad_filename
        if not ad_path.exists():
            return {"ad_filename": ad_filename, "status": "NOT_FOUND",
                     "error": f"Ad file not found: {ad_path}"}

        with open(ad_path, 'r') as f:
            ad_text = f.read()

        ad_title = ad_filename.replace('.txt', '')
        result = self.engine.extract(ad_title, ad_text)

        expected_verdict = GROUND_TRUTH_DEV.get(ad_filename)
        if expected_verdict is None:
            return {"ad_filename": ad_filename, "status": "NO_LABEL",
                     "error": f"No ground truth label found for {ad_filename}"}

        actual_verdict = result.primary_verdict
        correct = (actual_verdict == expected_verdict)
        self.confusion_matrix[expected_verdict][actual_verdict] += 1

        return {
            "ad_filename": ad_filename,
            "status": "PASS" if correct else "FAIL",
            "expected": expected_verdict,
            "actual": actual_verdict,
            "confidence": result.confidence_score,
            "evidence_summary": result.evidence_summary,
            "matched_rules": [m.rule_id for m in result.matches],
        }

    def run_all(self):
        for ad_filename in sorted(GROUND_TRUTH_DEV.keys()):
            r = self.run_test(ad_filename)
            self.results.append(r)
        return self.results

    def summary(self):
        total = len(self.results)
        passed = sum(1 for r in self.results if r.get("status") == "PASS")
        failed = [r for r in self.results if r.get("status") == "FAIL"]
        not_found = [r for r in self.results if r.get("status") == "NOT_FOUND"]
        return {
            "total": total,
            "passed": passed,
            "failed_count": len(failed),
            "not_found_count": len(not_found),
            "accuracy": round(passed / total * 100, 1) if total else 0.0,
            "failed": failed,
            "not_found": not_found,
            "confusion_matrix": self.confusion_matrix,
        }


if __name__ == "__main__":
    rules_file = sys.argv[1] if len(sys.argv) > 1 else "tier_1_rules.yaml"
    ads_dir = sys.argv[2] if len(sys.argv) > 2 else "ads_dev"

    harness = TestHarness(rules_file, ads_dir)
    harness.run_all()
    summary = harness.summary()

    print(f"\n{'='*80}")
    print(f"DEV SET TEST RESULTS — {summary['total']} ads")
    print(f"{'='*80}")
    print(f"Accuracy: {summary['passed']}/{summary['total']} ({summary['accuracy']}%)")
    if summary['not_found_count']:
        print(f"NOT FOUND: {summary['not_found_count']}")
        for nf in summary['not_found']:
            print(f"  - {nf['ad_filename']}: {nf['error']}")

    print(f"\nConfusion Matrix (rows=expected, cols=actual):")
    labels = ["Skip", "Tailor", "Apply"]
    print(f"{'':>10}" + "".join(f"{l:>10}" for l in labels))
    for row_label in labels:
        row = summary['confusion_matrix'][row_label]
        print(f"{row_label:>10}" + "".join(f"{row[l]:>10}" for l in labels))

    if summary['failed']:
        print(f"\n{'='*80}")
        print(f"FAILURES ({summary['failed_count']}):")
        print(f"{'='*80}")
        for f in summary['failed']:
            print(f"\n  {f['ad_filename']}")
            print(f"    Expected: {f['expected']}  |  Actual: {f['actual']}  |  Confidence: {f['confidence']:.2f}")
            print(f"    Matched rules: {f['matched_rules']}")
            print(f"    Evidence: {f['evidence_summary'][:200]}")

    with open("test_results_dev.json", "w") as out:
        json.dump(summary, out, indent=2)
    print(f"\nFull results written to test_results_dev.json")