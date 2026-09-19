/**
 * Deterministic extraction fallback functions.
 *
 * Each function returns an EvidenceField whose `text`, `start`, and `end`
 * are located character-for-character in `adText`.
 *
 * Principle: NO SPAN, NO CLAIM.
 *
 * Fallbacks are intentionally conservative:
 *   - they match only explicit eligibility wording
 *   - they never infer from context
 *   - they never create verdict logic
 *
 * These are used in `src/app/api/extract/route.ts` as a secondary signal
 * when Gemini's structured extraction misses a pattern.
 */

import type { EvidenceField } from "../types/job";

/**
 * Returns the first regex match in `adText`, or undefined if none match.
 * The returned span points to the exact match characters.
 */
function matchFirst(
  adText: string,
  patterns: RegExp[],
  value: string
): EvidenceField | undefined {
  for (const pattern of patterns) {
    const match = adText.match(pattern);

    if (match && match.index !== undefined) {
      return {
        value,
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
      };
    }
  }

  return undefined;
}

// --------------------------------------------------
// CITIZENSHIP
// --------------------------------------------------

export function fallbackCitizenship(adText: string): EvidenceField | undefined {
  return matchFirst(
    adText,
    [
      /\bBe an Australian citizen(?: at the time of application)?\b/i,

      /\bAustralian Citizenship is mandatory\b/i,

      /\bAustralian citizenship (?:is )?(?:required|mandatory|essential)\b/i,

      /\bmust be an? Australian citizen\b/i,

      /\bAustralian citizen(?:ship)? required\b/i,

      /\bapplicants must be Australian citizens?\b/i,
    ],
    "Australian citizenship required"
  );
}

// --------------------------------------------------
// PERMANENT RESIDENCY
// --------------------------------------------------

/**
 * Matches explicit candidate-eligibility permanent-residency wording.
 *
 * Conservative: does NOT match generic uses of "resident", "residency",
 * or "residence" that are not candidate-eligibility requirements.
 *
 * Supported:
 *   - "permanent residents only"
 *   - "Permanent residency required / mandatory / essential"
 *   - "must be an Australian permanent resident"
 *   - "Australian citizen or permanent resident" (and plural / slash variants)
 *   - "Australian citizen or PR" (with trailing boundary guard)
 */
export function fallbackResidency(adText: string): EvidenceField | undefined {
  return matchFirst(
    adText,
    [
      // "permanent residents only"
      /\bpermanent residents?\s+only\b/i,

      // "permanent residency required / mandatory / essential"
      /\bpermanent residen(?:cy|t)\s+(?:is\s+)?(?:required|mandatory|essential)\b/i,

      // "must be an Australian permanent resident"
      /\bmust be an? Australian permanent resident\b/i,

      // "Australian citizen(s/ship) or permanent resident(s)"
      /\bAustralian citizen(?:s|ship)?\s+or\s+permanent residents?\b/i,

      // "Australian citizen(s/ship) / permanent resident(s)"
      /\bAustralian citizen(?:s|ship)?\s*\/\s*permanent residents?\b/i,

      // "Australian citizen or PR" — lookahead prevents matching "PR consultant" etc.
      /\bAustralian citizen(?:s|ship)?\s+or\s+PR\b(?=[\s,;.()\r\n]|$)/i,
    ],
    "Australian permanent residency required"
  );
}

// --------------------------------------------------
// SECURITY CLEARANCE
// --------------------------------------------------

/**
 * Matches explicit security-clearance requirements.
 *
 * Conservative: does NOT match "security" appearing in unrelated contexts
 * such as "cyber security team" or "information security".
 * Every pattern requires either:
 *   - a specific clearance code (NV1, NV2, Baseline), or
 *   - the compound phrase "security clearance" combined with
 *     a requirement verb or qualifier.
 *
 * Supported:
 *   - "Negative Vetting Level 1 / 2"
 *   - "NV1 clearance", "NV2 clearance"
 *   - "NV1" / "NV2" standalone
 *   - "Baseline Security Clearance"
 *   - "Australian Government security clearance"
 *   - "security clearance required / mandatory / essential"
 *   - "must [be able to] obtain [and maintain] ... security clearance"
 */
export function fallbackSecurityClearance(
  adText: string
): EvidenceField | undefined {
  return matchFirst(
    adText,
    [
      // Negative Vetting Level 1 / 2 (full name)
      /\bNegative Vetting Level [12]\b/i,

      // NV1/NV2 paired with "clearance" — more specific, checked first
      /\bNV[12]\s+(?:security\s+)?clearance\b/i,

      // NV1/NV2 standalone — specific enough to Australian gov clearance codes
      /\bNV[12]\b/i,

      // Baseline security clearance
      /\bBaseline Security Clearance\b/i,

      // "Australian Government security clearance" (explicit phrase)
      /\bAustralian Government security clearance\b/i,

      // "security clearance required / mandatory / essential"
      /\bsecurity clearance\s+(?:is\s+)?(?:required|mandatory|essential)\b/i,

      // "must [be able to] obtain [and maintain] [a[n]] [...] security clearance"
      /\bmust\s+(?:be able to\s+)?(?:obtain|hold|have|maintain)(?:\s+and\s+maintain)?\s+(?:an?\s+)?(?:Australian Government\s+)?security clearance\b/i,
    ],
    "Security clearance required"
  );
}

// --------------------------------------------------
// TEMPORARY VISA ALLOWED
// --------------------------------------------------

/**
 * Matches explicit wording showing temporary visa holders or international
 * candidates with an appropriate visa may be considered or offered employment.
 *
 * CRITICAL FALSE-POSITIVE GUARD:
 *   Do NOT add patterns matching any of:
 *     - "full working rights"
 *     - "full Australian working rights"
 *     - "unrestricted working rights"
 *     - "valid Australian work rights"
 *   Those belong under workRightsRequirement.
 *
 * This protection matters because `temporaryVisaAllowed` is evaluated
 * BEFORE citizenship/PR hard blockers in rules.ts. A false positive here
 * could suppress a valid SKIP verdict.
 */
export function fallbackTemporaryVisaAllowed(
  adText: string
): EvidenceField | undefined {
  return matchFirst(
    adText,
    [
      // Exact wording from known real ads (narrow, high-precision)
      /\btemporary visa that allows you to live and work in Australia, you may be offered employment in line with the conditions of your visa\b/i,
      /\bcitizen of another country with an appropriate visa that allows you to work in Australia\b/i,

      // Broader: "temporary visa" + "may be offered employment" within same sentence
      /\btemporary visa\b[^\n\r.]{0,180}\bmay be offered employment\b[^\n\r.]*/i,

      // "or hold an appropriate visa that allows you to live and work in Australia"
      /\bor hold an appropriate visa that allows you to live and work in Australia\b/i,

      // "employment of a temporary visa holder will only be offered..."
      /\bemployment of a temporary visa holder will only be offered\b/i,

      // "temporary visa holder(s) may/can be considered / apply / be offered"
      /\btemporary visa holders?\s+(?:may|can)\s+(?:be\s+)?(?:considered|apply|be\s+offered)\b/i,

      // "appropriate visa that allows ... work in Australia" (explicit pathway)
      /\bappropriate visa\s+that allows\b[^\n\r.]{0,80}\bwork in Australia\b/i,
    ],
    "Temporary visa holders explicitly allowed"
  );
}

// --------------------------------------------------
// LOCATION
// --------------------------------------------------

export function fallbackLocation(adText: string): EvidenceField | undefined {
  const labelledMatch = adText.match(/(?:^|\n)\s*Location:\s*([^\n\r]+)/i);

  if (labelledMatch) {
    const text = labelledMatch[1].trim();
    const searchFrom = labelledMatch.index ?? 0;
    const start = adText.indexOf(text, searchFrom);

    if (start !== -1) {
      return { value: text, text, start, end: start + text.length };
    }
  }

  const cityMatch = adText.match(
    /\b(?:Sydney|Melbourne|Brisbane|Perth|Adelaide|Canberra|Hobart|Darwin)\s+(?:NSW|VIC|QLD|WA|SA|ACT|TAS|NT)\b/i
  );

  if (!cityMatch || cityMatch.index === undefined) {
    return undefined;
  }

  return {
    value: cityMatch[0],
    text: cityMatch[0],
    start: cityMatch.index,
    end: cityMatch.index + cityMatch[0].length,
  };
}

// --------------------------------------------------
// PROFESSIONAL REGISTRATION
// --------------------------------------------------

export function fallbackRegistration(
  adText: string
): EvidenceField | undefined {
  return matchFirst(
    adText,
    [
      /\bCurrent Registered Nurse registration \(AHPRA\)\b/i,
      /\bcurrent AHPRA registration\b/i,
      /\bAHPRA registration\b/i,
      /\bregistered with AHPRA\b/i,
      /\beligible for admission in (?:Queensland|NSW|Victoria|WA|SA|TAS|ACT)\b/i,
      /\bAustralian legal practising certificate\b/i,
    ],
    "Professional registration requirement"
  );
}

// --------------------------------------------------
// VISA PLAN REQUIREMENT
// --------------------------------------------------

/**
 * Matches explicit wording where the employer asks the applicant to
 * explain, document, or outline future visa plans or pathways.
 *
 * Does NOT match:
 *   - current-visa screening questions ("What visa do you currently hold?")
 *   - generic visa mentions
 *   - sponsorship wording
 *
 * Supported:
 *   - "proposed next visa plan[s]"
 *   - "proposed visa plan[s]"
 *   - "outline your visa plan[s]"
 *   - "outlining [your] [proposed] [next] visa plan[s]"
 *   - "provide details of your proposed visa pathway"
 *   - "explain your future visa pathway"
 *   - "document outlining proposed next visa plan[s]"
 */
export function fallbackVisaPlanRequirement(
  adText: string
): EvidenceField | undefined {
  return matchFirst(
    adText,
    [
      // "proposed next visa plan[s]"
      /\bproposed next visa plans?\b/i,

      // "proposed visa plan[s]" (without "next")
      /\bproposed visa plans?\b/i,

      // "outline your visa plan[s]"
      /\boutline your visa plans?\b/i,

      // "outlining [your] [proposed] [next] visa plan[s]"
      /\boutlining\s+(?:your\s+)?(?:proposed\s+)?(?:next\s+)?visa plans?\b/i,

      // "provide details of your proposed visa pathway"
      /\bprovide details of your proposed visa pathway\b/i,

      // "explain your future visa pathway"
      /\bexplain(?:ing)? your future visa pathway\b/i,

      // "document outlining proposed next visa plan[s]"
      /\bdocument outlining proposed next visa plans?\b/i,
    ],
    "Future visa plan required"
  );
}

// --------------------------------------------------
// ROLE FIELD
// --------------------------------------------------

export function fallbackRoleField(adText: string): EvidenceField | undefined {
  const firstLine = adText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) {
    return undefined;
  }

  const looksLikeRole =
    /\b(engineer|developer|analyst|scientist|designer|consultant|coordinator|manager|accountant|architect|specialist|administrator|technician)\b/i.test(
      firstLine
    );

  if (!looksLikeRole) {
    return undefined;
  }

  const start = adText.indexOf(firstLine);

  if (start === -1) {
    return undefined;
  }

  return {
    value: firstLine,
    text: firstLine,
    start,
    end: start + firstLine.length,
  };
}

// --------------------------------------------------
// CONTEXTUAL OR-CLAUSE HELPERS
// --------------------------------------------------

/**
 * Walks backward from `pos` to find where the current clause starts.
 * Clause boundaries: newline, carriage return, semicolon, period.
 */
function findClauseStart(adText: string, pos: number): number {
  let i = pos;
  while (i > 0) {
    const prev = adText[i - 1];
    if (prev === "\n" || prev === "\r" || prev === ";" || prev === ".") break;
    i--;
  }
  return i;
}

/**
 * Walks forward from `pos` to find where the current clause ends.
 * Includes a terminating period. Stops at newline, carriage return, or semicolon.
 * `minEnd` prevents the end from retreating behind the evidence end.
 */
function findClauseEnd(adText: string, pos: number, minEnd: number): number {
  let i = Math.max(pos, minEnd);
  while (i < adText.length) {
    const ch = adText[i];
    if (ch === "\n" || ch === "\r" || ch === ";") break;
    if (ch === ".") {
      i++; // include the period
      break;
    }
    i++;
  }
  return i;
}

/**
 * Extracts the logical clause (sentence or line) surrounding the span
 * `evidenceStart..evidenceEnd`. Used by hasFullWorkRightsAlternative.
 *
 * Does NOT cross sentence boundaries — a work-right phrase in a DIFFERENT
 * sentence is not considered part of the same clause.
 */
function extractContainingClause(
  adText: string,
  evidenceStart: number,
  evidenceEnd: number
): string {
  const clauseStart = findClauseStart(adText, evidenceStart);
  const clauseEnd = findClauseEnd(adText, evidenceEnd, clauseStart);
  return adText.slice(clauseStart, clauseEnd);
}

/** Pattern for explicit full/unrestricted working-rights phrases. */
const FULL_WORK_RIGHTS_RE =
  /\b(?:full(?:\s+Australian)?\s+work(?:ing)?\s+rights|unrestricted\s+work(?:ing)?\s+rights|work(?:ing)?\s+without\s+restriction)\b/i;

/**
 * Returns true when the same logical clause (sentence or line) that contains
 * `field` also explicitly offers full or unrestricted working rights as an
 * OR-alternative pathway, AND an explicit alternative separator (`or` or `/`)
 * appears in the text BETWEEN the evidence branch and the work-rights phrase.
 *
 * Triggering shapes:
 *   "Australian citizen or have full working rights"
 *   "Australian or NZ Citizen or have unrestricted working rights"
 *   "citizen, Permanent Resident or able to provide evidence of full working rights"
 *   "Australian citizen / full working rights"
 *
 * Does NOT fire on:
 *   "Australian or New Zealand citizen with full working rights"
 *     — the "or" is inside the evidence span; the between text is " with "
 *   "Australian/New Zealand citizen with unrestricted working rights"
 *     — the "/" is inside the evidence span; the between text is " with "
 *   "Australian citizen and full working rights required"
 *     — between text is " and ", which contains no "or" or "/"
 *   "Australian citizens. Full working rights required."
 *     — different sentences; the period terminates the clause before work rights
 *   Generic "right to work" wording — not matched by FULL_WORK_RIGHTS_RE
 *
 * IMPORTANT: Does NOT populate temporaryVisaAllowed.
 */
export function hasFullWorkRightsAlternative(
  adText: string,
  field: EvidenceField | undefined
): boolean {
  if (!field) return false;

  // Use field.start to anchor the clause. This avoids depending on field.end,
  // which might be excessively wide (e.g. if Gemini extracts the entire clause).
  const clauseStart = findClauseStart(adText, field.start);
  const clauseEnd = findClauseEnd(adText, field.start, clauseStart);
  const clause = adText.slice(clauseStart, clauseEnd);

  // 1. Locate the full/unrestricted working-rights phrase within the clause.
  const wrMatch = FULL_WORK_RIGHTS_RE.exec(clause);
  if (!wrMatch) return false;
  const wrStart = wrMatch.index;

  // 2. Locate the relevant citizenship/residency branch BEFORE the work-right phrase.
  // We search for the last blocker token that ends before wrStart.
  const blockerTokens = /\b(citizen|citizenship|permanent resident|permanent residency|pr)\b/gi;
  let lastBlockerEnd = -1;
  let match;
  while ((match = blockerTokens.exec(clause)) !== null) {
    const matchEnd = match.index + match[0].length;
    if (matchEnd <= wrStart) {
      lastBlockerEnd = matchEnd;
    } else {
      break;
    }
  }

  // If no citizenship/residency token appears before the work rights phrase, we abort.
  if (lastBlockerEnd === -1) {
    return false;
  }

  // 3. Inspect only the text BETWEEN that logical branch end and the work-right phrase.
  const between = clause.slice(lastBlockerEnd, wrStart);

  // 4. Suppress only when that between-text contains an actual alternative separator.
  return /\bor\b|\//i.test(between);
}

export function filterTemporaryVisaAllowed(
  field: EvidenceField | undefined
): EvidenceField | undefined {
  if (!field) return undefined;

  const text = field.text.toLowerCase();

  // Reject generic diversity/inclusion wording
  if (/\b(nationalities|people (?:of|from) all backgrounds|international culture|diversity|inclusion)\b/i.test(text)) {
    return undefined;
  }

  // Reject explicitly negative, unavailable, or screening language
  if (/\b(?:not available|cannot sponsor|no (?:visa )?sponsorship|sponsorship (?:is )?unavailable|visa required|what visa do you currently hold)\b/i.test(text)) {
    return undefined;
  }

  // Require positive eligibility/consideration semantics.
  // Mere presence of "visa", "sponsor", or "sponsorship" is insufficient.
  const positivePattern = /\b(?:temporary visa holders?|appropriate visa that allows|citizen of another country|sponsorship (?:is )?(?:available|offered|provided)|offer sponsor(?:ship)?|we (?:can|will) sponsor)\b/i;

  if (!positivePattern.test(text)) {
    return undefined;
  }

  return field;
}

/**
 * Deterministic fallback for explicit full/unrestricted working-rights
 * requirements.
 *
 * Use this as a fallback when Gemini does not extract workRightsRequirement
 * but the citizenship/residency field has been suppressed via
 * hasFullWorkRightsAlternative — ensuring the work-right field exists to
 * drive the profile-aware verdict in rules.ts.
 *
 * Conservative:
 *   - only matches explicit requirement phrases (not screening questions)
 *   - does NOT populate temporaryVisaAllowed
 *   - does NOT match generic "right to work in Australia" wording
 *
 * Preferred order: most specific phrases first.
 */
export function fallbackWorkRightsRequirement(
  adText: string
): EvidenceField | undefined {
  return matchFirst(
    adText,
    [
      /\bfull Australian working rights\b/i,
      /\bfull Australian work rights\b/i,
      /\bfull working rights\b/i,
      /\bfull work rights\b/i,
      /\bunrestricted working rights\b/i,
      /\bunrestricted work rights\b/i,
      /\bwork without restriction\b/i,
      /\bworking without restriction\b/i,
      /\bvalid visa with full work rights\b/i,
    ],
    "Full working rights required"
  );
}
