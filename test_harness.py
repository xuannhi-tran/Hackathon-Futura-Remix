#!/usr/bin/env python3
"""
Test Harness for Tier 1 Extraction Pipeline
Validates extraction results against hand-labeled verdicts.
"""

import json
import sys
from extraction_pipeline import Tier1RulesEngine, ExtractionResult
from pathlib import Path

# Hand-labeled ground truth verdicts (from corpus)
GROUND_TRUTH = {
    "01_aps_data_stream.txt": "Skip",
    "04_dfat_graduate_program.txt": "Skip",
    "10_rei_graduate_software_developer.txt": "Skip",
    "15_caringbah_family_practice_rn.txt": "Tailor",
    "20_velocity_legal_graduate.txt": "Apply",
    # Additional labels for full corpus
    "02_aps_stem_stream.txt": "Skip",
    "03_aps_generalist_stream.txt": "Skip",
    "05_nsw_health_senior_data_analyst.txt": "Tailor",
    "06_aps4_participant_support_officer.txt": "Skip",
    "11_arturia_ai_graduate_software_engineer.txt": "Skip",
    "12_springtek_junior_software_engineer.txt": "Skip",
    "13_sg_fleet_software_engineering_internship.txt": "Skip",
    "14_lynxx_junior_backend_developer.txt": "Skip",
    "16_healthscope_graduate_enrolled_nurse.txt": "Tailor",
    "17_cabrini_health_graduate_rn.txt": "Tailor",
    "18_innisfail_medical_centre_gp_nurse.txt": "Tailor",
    "19_proforce_graduate_role.txt": "Skip",
    "21_qld_law_firm_graduate.txt": "Skip",
    # 22_* removed 2026-09-19: file never made it into the corpus folder,
    # and PROJECT_HANDOFF.md ("Sharp & Carter Graduate Consultant") and
    # job_ads_corpus.md ("SEEK visa-sponsor customer support role") disagree
    # on what ad #22 even is. Re-add once the real file + one agreed label exists.
    "23_service_stream_finance_graduate.txt": "Skip",
}

class TestHarness:
    """Run extraction pipeline on test ads and compare to ground truth."""

    def __init__(self, rules_file: str, ads_dir: str):
        """Initialize test harness."""
        self.engine = Tier1RulesEngine(rules_file)
        self.ads_dir = Path(ads_dir)
        self.results = []
        self.confusion_matrix = {
            "Skip": {"Skip": 0, "Tailor": 0, "Apply": 0},
            "Tailor": {"Skip": 0, "Tailor": 0, "Apply": 0},
            "Apply": {"Skip": 0, "Tailor": 0, "Apply": 0},
        }

    def run_test(self, ad_filename: str) -> dict:
        """Run extraction on a single ad and compare to ground truth."""
        ad_path = self.ads_dir / ad_filename

        if not ad_path.exists():
            return {
                "ad_filename": ad_filename,
                "status": "NOT_FOUND",
                "error": f"Ad file not found: {ad_path}"
            }

        # Load ad text
        with open(ad_path, 'r') as f:
            ad_text = f.read()

        # Extract title (first line or filename)
        ad_title = ad_filename.replace('.txt', '')

        # Run extraction
        result = self.engine.extract(ad_title, ad_text)

        # Get ground truth
        expected_verdict = GROUND_TRUTH.get(ad_filename)
        if expected_verdict is None:
            return {
                "ad_filename": ad_filename,
                "status": "NO_LABEL",
                "error": f"No ground truth label found for {ad_filename}"
            }

        # Compare
        predicted_verdict = result.primary_verdict
        is_correct = predicted_verdict == expected_verdict

        # Update confusion matrix
        self.confusion_matrix[expected_verdict][predicted_verdict] += 1

        return {
            "ad_filename": ad_filename,
            "status": "OK",
            "expected_verdict": expected_verdict,
            "predicted_verdict": predicted_verdict,
            "confidence": result.confidence_score,
            "is_correct": is_correct,
            "evidence_summary": result.evidence_summary,
            "num_matches": len(result.matches),
            "top_rule": result.matches[0].rule_id if result.matches else None,
        }

    def run_all_tests(self, test_ads: list = None) -> dict:
        """Run tests on specified ads or all available ads."""
        if test_ads is None:
            test_ads = list(GROUND_TRUTH.keys())

        print(f"\n{'='*80}")
        print(f"🧪 TIER 1 EXTRACTION PIPELINE TEST HARNESS")
        print(f"{'='*80}")
        print(f"Running {len(test_ads)} tests...\n")

        all_results = []
        for ad_filename in test_ads:
            result = self.run_test(ad_filename)
            all_results.append(result)
            self.results.append(result)

            # Print result
            if result["status"] == "OK":
                status_icon = "✅" if result["is_correct"] else "❌"
                print(f"{status_icon} {result['ad_filename']}")
                print(f"   Expected: {result['expected_verdict']:6} | Predicted: {result['predicted_verdict']:6} | Confidence: {result['confidence']:.2f}")
                if result["top_rule"]:
                    print(f"   Top Rule: {result['top_rule']}")
                print()
            else:
                print(f"⚠️  {result['ad_filename']}: {result['status']} — {result['error']}\n")

        return all_results

    def print_summary(self):
        """Print test summary and metrics."""
        ok_results = [r for r in self.results if r["status"] == "OK"]

        if not ok_results:
            print("❌ No valid results to summarize.")
            return

        correct = sum(1 for r in ok_results if r["is_correct"])
        total = len(ok_results)
        accuracy = (correct / total * 100) if total > 0 else 0.0

        print(f"\n{'='*80}")
        print(f"📊 TEST SUMMARY")
        print(f"{'='*80}")
        print(f"Total Tests: {total}")
        print(f"Passed: {correct}")
        print(f"Failed: {total - correct}")
        print(f"Accuracy: {accuracy:.1f}%\n")

        # Confusion matrix
        print(f"{'='*80}")
        print(f"📋 CONFUSION MATRIX (Ground Truth vs. Predicted)")
        print(f"{'='*80}")
        header = f"{'Actual / Pred':15} {'Skip':10} {'Tailor':10} {'Apply':10}"
        print(header)
        print(f"{'-'*45}")
        for actual in ["Skip", "Tailor", "Apply"]:
            row = f"{actual:15}"
            for predicted in ["Skip", "Tailor", "Apply"]:
                count = self.confusion_matrix[actual][predicted]
                row += f"{count:10}"
            print(row)

        # Per-verdict accuracy
        print(f"\n{'='*80}")
        print(f"📈 PER-VERDICT ACCURACY")
        print(f"{'='*80}")
        for verdict in ["Skip", "Tailor", "Apply"]:
            total_with_verdict = sum(1 for r in ok_results if r["expected_verdict"] == verdict)
            correct_with_verdict = sum(1 for r in ok_results if r["expected_verdict"] == verdict and r["is_correct"])
            pct = (correct_with_verdict / total_with_verdict * 100) if total_with_verdict > 0 else 0.0
            print(f"{verdict:10}: {correct_with_verdict}/{total_with_verdict} ({pct:.1f}%)")

        # Detailed failure analysis
        failures = [r for r in ok_results if not r["is_correct"]]
        if failures:
            print(f"\n{'='*80}")
            print(f"❌ FAILURE ANALYSIS ({len(failures)} mismatches)")
            print(f"{'='*80}")
            for result in failures:
                print(f"\n{result['ad_filename']}")
                print(f"  Expected: {result['expected_verdict']} | Predicted: {result['predicted_verdict']}")
                print(f"  Confidence: {result['confidence']:.2f}")
                print(f"  Evidence: {result['evidence_summary'][:100]}...")
                print(f"  Matches: {result['num_matches']} rule(s) | Top: {result['top_rule']}")

    def export_json(self, output_file: str):
        """Export results as JSON."""
        output_data = {
            "test_run": {
                "total_tests": len(self.results),
                "passed": sum(1 for r in self.results if r.get("is_correct")),
                "accuracy": sum(1 for r in self.results if r.get("is_correct")) / len([r for r in self.results if r["status"] == "OK"]) * 100 if any(r["status"] == "OK" for r in self.results) else 0.0,
            },
            "confusion_matrix": self.confusion_matrix,
            "results": self.results,
        }
        with open(output_file, 'w') as f:
            json.dump(output_data, f, indent=2)
        print(f"\n📤 Results exported to {output_file}")

if __name__ == "__main__":
    # Configuration
    RULES_FILE = "tier_1_rules.yaml"
    ADS_DIR = "job_description_txt"  # renamed from ads/ during corpus build

    # Test on all ads (or 5 representative if specified)
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "full":
        test_ads = list(GROUND_TRUTH.keys())
    else:
        # Test on 5 representative ads by default
        test_ads = [
            "01_aps_data_stream.txt",
            "04_dfat_graduate_program.txt",
            "10_rei_graduate_software_developer.txt",
            "15_caringbah_family_practice_rn.txt",
            "20_velocity_legal_graduate.txt",
        ]

    # Initialize and run harness
    harness = TestHarness(RULES_FILE, ADS_DIR)
    harness.run_all_tests(test_ads)
    harness.print_summary()
    harness.export_json("test_results.json")
