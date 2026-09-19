import { Verdict } from "../types/job";
import { findClauseStart, findClauseEnd } from "./extractionFallbacks";

export function getDisplayEvidenceSpan(
  adText: string,
  verdict: Verdict
): { displayStart: number; displayEnd: number } | null {
  if (!verdict?.evidence) return null;
  const { start, end } = verdict.evidence;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start ||
    end > adText.length
  ) {
    return null;
  }

  let displayStart = start;
  let displayEnd = end;

  const relevantRules = [
    "T1_CITIZENSHIP",
    "T1_PERMANENT_RESIDENCY",
    "T1_FULL_WORK_RIGHTS_STUDENT_500",
    "T2_WORK_RIGHTS_REVIEW",
  ];

  if (verdict.ruleId && relevantRules.includes(verdict.ruleId)) {
    let clauseStart = findClauseStart(adText, start);
    let clauseEnd = findClauseEnd(adText, start, clauseStart);

    while (clauseStart < clauseEnd && /\s/.test(adText[clauseStart])) {
      clauseStart++;
    }
    while (clauseEnd > clauseStart && /\s/.test(adText[clauseEnd - 1])) {
      clauseEnd--;
    }

    const clause = adText.slice(clauseStart, clauseEnd);

    const hasBlocker =
      /\b(citizen|citizenship|permanent resident|permanent residency|pr)\b/i.test(
        clause
      );
    const hasWorkRights =
      /\b(work(?:ing)?\s+rights|unrestricted\s+work|legally entitled to work|right to work)\b/i.test(
        clause
      );
    const hasOr = /\bor\b|\//i.test(clause);

    const blockerMatches =
      clause.match(
        /\b(citizen|citizenship|permanent resident|permanent residency|pr)\b/gi
      ) || [];
    const distinctBlockers = new Set(
      blockerMatches.map((m) => m.toLowerCase())
    );

    if (
      hasOr &&
      ((hasBlocker && hasWorkRights) || distinctBlockers.size >= 2)
    ) {
      displayStart = clauseStart;
      displayEnd = clauseEnd;
    }
  }

  return { displayStart, displayEnd };
}
