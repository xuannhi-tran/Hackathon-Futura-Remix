#!/usr/bin/env python3
"""
Tier 1 Rules Extraction Pipeline
Deterministic rules engine for job ad eligibility screening.
Inputs: job ad text + tier_1_rules.yaml
Outputs: blocker signals with evidence spans and confidence scores.
"""

import re
import yaml
from dataclasses import dataclass
from typing import List, Dict, Optional, Tuple
import json

@dataclass
class Match:
    """A single regex pattern match."""
    rule_id: str
    pattern: str
    matched_text: str
    start_idx: int
    end_idx: int
    confidence: float
    category: str
    signal_type: str
    verdict: str
    notes: str

@dataclass
class ExtractionResult:
    """Output of extraction pipeline for one ad."""
    ad_title: str
    ad_text: str
    matches: List[Match]
    primary_verdict: str  # Skip, Tailor, Apply
    confidence_score: float
    evidence_summary: str

class Tier1RulesEngine:
    """Load and apply Tier 1 rules to job ad text."""

    def __init__(self, rules_file: str):
        """Load rules from YAML file."""
        with open(rules_file, 'r') as f:
            self.config = yaml.safe_load(f)
        self.rules = self.config.get('rules', [])

    def extract_eligibility_section(self, ad_text: str) -> str:
        """Extract the eligibility/criteria section from ad text (heuristic)."""
        # Look for common section headers. Ordered roughly by specificity —
        # broadened beyond "eligibility/criteria/must have" after the dev-set
        # run found ads that use headers like "What we're looking for:"
        # instead, with no other "eligibility"-type keyword anywhere in the
        # text — causing the old marker list to fall through to a stray,
        # unrelated use of a bare word like "requirement" near the end of
        # the ad and chop off the real eligibility content before it.
        eligibility_markers = [
            r'(?i)(?:eligibility|requirement|criteria|must have)',
            r'(?i)(?:to be eligible|who we are looking for)',
            r'(?i)(?:application requirements|what we need)',
            r"(?i)(?:what we're looking for|who we're looking for)",
            r'(?i)(?:who you are|who may apply|about you)',
        ]

        # Minimum trailing length for a marker match to be trusted as a real
        # section header rather than a coincidental word usage near the end
        # of the ad (e.g. "...but it's not a requirement." in a closing
        # sentence, which is not an eligibility-section header at all).
        MIN_SECTION_LENGTH = 150

        # Find where eligibility content likely starts
        for marker in eligibility_markers:
            match = re.search(marker, ad_text)
            if match:
                start = match.start()
                if len(ad_text) - start < MIN_SECTION_LENGTH:
                    # Suspiciously little text follows this match — likely a
                    # false-positive keyword hit, not a real section header.
                    # Skip it and let the next marker (or the final fallback
                    # to full text) take over instead.
                    continue
                # Look for next section header (all caps line or "About" prefix)
                next_section = re.search(r'\n[A-Z][A-Z\s]{5,}', ad_text[start+100:])
                if next_section:
                    return ad_text[start:start+100+next_section.start()]
                else:
                    return ad_text[start:]

        # Fallback: return whole text if no (trustworthy) section found
        return ad_text

    def apply_rule(self, rule: Dict, text: str) -> List[Match]:
        """Apply a single rule to text, return all matches."""
        matches = []
        rule_id = rule.get('rule_id')
        patterns = rule.get('patterns', [])
        confidence = rule.get('confidence', 0.5)
        category = rule.get('category')
        signal_type = rule.get('signal_type')
        verdict = rule.get('verdict')
        notes = rule.get('notes')

        for pattern in patterns:
            try:
                for match_obj in re.finditer(pattern, text):
                    matched_text = match_obj.group(0)
                    matches.append(Match(
                        rule_id=rule_id,
                        pattern=pattern,
                        matched_text=matched_text,
                        start_idx=match_obj.start(),
                        end_idx=match_obj.end(),
                        confidence=confidence,
                        category=category,
                        signal_type=signal_type,
                        verdict=verdict,
                        notes=notes,
                    ))
            except re.error as e:
                print(f"⚠️  Regex error in {rule_id}: {e}")
                continue

        return matches

    def extract(self, ad_title: str, ad_text: str) -> ExtractionResult:
        """Extract blockers from a job ad."""
        # Focus on eligibility section
        eligibility_text = self.extract_eligibility_section(ad_text)

        all_matches = []

        # Apply all rules
        for rule in self.rules:
            matches = self.apply_rule(rule, eligibility_text)
            all_matches.extend(matches)

        # Determine primary verdict based on highest-confidence hard blocker
        hard_blockers = [m for m in all_matches if m.signal_type == "HARD_BLOCKER"]
        conditionals = [m for m in all_matches if m.signal_type == "CONDITIONAL"]
        temp_visa_allowed = [m for m in conditionals if m.rule_id == "TEMPORARY_VISA_ALLOWED"]

        # Special case: if ad explicitly allows temporary visa holders, downgrade to Tailor
        if hard_blockers and temp_visa_allowed:
            primary_verdict = "Tailor"
            top_match = max(temp_visa_allowed, key=lambda m: m.confidence)
            confidence_score = top_match.confidence
        elif hard_blockers:
            primary_verdict = "Skip"
            top_match = max(hard_blockers, key=lambda m: m.confidence)
            confidence_score = top_match.confidence
        elif conditionals:
            primary_verdict = "Tailor"
            top_match = max(conditionals, key=lambda m: m.confidence)
            confidence_score = top_match.confidence
        else:
            primary_verdict = "Apply"
            confidence_score = 0.65  # Default for "no blocker found"

        # Build evidence summary
        if all_matches:
            evidence_texts = [m.matched_text for m in sorted(all_matches, key=lambda m: m.confidence, reverse=True)[:3]]
            evidence_summary = " | ".join(evidence_texts)
        else:
            evidence_summary = "No eligibility blockers detected"

        return ExtractionResult(
            ad_title=ad_title,
            ad_text=ad_text,
            matches=all_matches,
            primary_verdict=primary_verdict,
            confidence_score=confidence_score,
            evidence_summary=evidence_summary,
        )

def format_result_for_display(result: ExtractionResult) -> str:
    """Pretty-print extraction result."""
    output = []
    output.append(f"\n{'='*80}")
    output.append(f"📋 AD: {result.ad_title}")
    output.append(f"{'='*80}")
    output.append(f"🎯 VERDICT: {result.primary_verdict} (confidence: {result.confidence_score:.2f})")
    output.append(f"📝 EVIDENCE: {result.evidence_summary}")

    if result.matches:
        output.append(f"\n📌 MATCHED RULES ({len(result.matches)} total):")
        for match in sorted(result.matches, key=lambda m: m.confidence, reverse=True):
            output.append(f"  • [{match.rule_id}] {match.verdict} (confidence: {match.confidence:.2f})")
            output.append(f"    Category: {match.category}")
            output.append(f"    Matched: \"{match.matched_text[:80]}...\"")
            output.append(f"    Notes: {match.notes[:100]}...")
    else:
        output.append(f"\n✅ No blockers matched.")

    output.append("")
    return "\n".join(output)

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python extraction_pipeline.py <rules_file.yaml> <ad_text_file.txt> [ad_title]")
        print("Example: python extraction_pipeline.py tier_1_rules.yaml ads/01_aps_data_stream.txt")
        sys.exit(1)

    rules_file = sys.argv[1]
    ad_file = sys.argv[2]
    ad_title = sys.argv[3] if len(sys.argv) > 3 else ad_file.split('/')[-1]

    # Load rules
    engine = Tier1RulesEngine(rules_file)

    # Load ad text
    with open(ad_file, 'r') as f:
        ad_text = f.read()

    # Extract
    result = engine.extract(ad_title, ad_text)

    # Display
    print(format_result_for_display(result))

    # Output JSON for further processing
    output_json = {
        "ad_title": result.ad_title,
        "verdict": result.primary_verdict,
        "confidence": result.confidence_score,
        "evidence_summary": result.evidence_summary,
        "matches": [
            {
                "rule_id": m.rule_id,
                "matched_text": m.matched_text,
                "span": [m.start_idx, m.end_idx],
                "confidence": m.confidence,
                "verdict": m.verdict,
            }
            for m in result.matches
        ]
    }
    print("\n📤 JSON OUTPUT:")
    print(json.dumps(output_json, indent=2))