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
export function findClauseStart(adText: string, pos: number): number {
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
export function findClauseEnd(
  adText: string,
  pos: number,
  minEnd: number
): number {
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

// --------------------------------------------------
// ELIGIBILITY CLAUSE ANALYSIS
//
// Given the citizenship / residency evidence span, decide which statuses the
// surrounding clause accepts. Works on structure, not on fixed phrases:
//
//   1. Scope   — the clause containing the span (findClauseStart/End), widened
//                to the whole list when the span sits in a disjunctive bullet
//                list.
//   2. Options — the scope is split into option segments at `,` `;` `/`
//                newlines and `or`. A segment that itself names
//                citizenship/PR is a status option, and any visa wording
//                inside it qualifies that status ("NZ citizen with full
//                working rights"), so it is never read as a separate option.
//   3. Accept  — every other segment is classified by category (full work
//                rights, 485, student visa, any visa with work rights).
//   4. Guard   — segments that negate or mention sponsorship, or that start
//                with "and" (a further requirement, not an alternative), are
//                not options.
// --------------------------------------------------

const BULLET_LINE_RE = /^[ \t]*(?:[-*•·▪●–—]|\d{1,2}[.)]|[a-z][.)])[ \t]+/;

/** Citizenship / permanent-residency wording. */
const STATUS_RE =
  /\b(?:citizens?|citizenship|permanent\s+resid(?:ents?|ency|ence)|PRs?)\b/i;

/** "a citizen of another country ..." is a visa-holder option, not a status. */
const OTHER_COUNTRY_RE = /\b(?:another|other|foreign|overseas)\b/i;

/** Explicit full / unrestricted working-rights phrases. */
const FULL_WORK_RIGHTS_RE =
  /\b(?:full(?:\s+Australian)?\s+work(?:ing)?\s+rights|unrestricted\s+work(?:ing)?\s+rights|work(?:ing)?\s+without\s+restriction)\b/i;

const GRADUATE_VISA_RE =
  /\b485\b|\bgraduate\s+(?:work\s+)?visas?\b|\bpost[- ]study\s+work\s+(?:visa|rights)\b/i;

const STUDENT_VISA_RE =
  /\bstudent\s+visas?\b|\bsubclass\s*500\b|\b500\s+visa\b|\bvisa\s+500\b/i;

/** Any visa / work-rights wording that is not a named subclass. */
const GENERIC_VISA_RE = new RegExp(
  [
    // "visa holder(s)", "holder of a ... visa"
    String.raw`\bvisa[- ]holders?\b`,
    String.raw`\bholders?\s+of\s+(?:an?\s+|any\s+)?(?:\w+\s+){0,3}visa\b`,
    // "valid / appropriate / suitable ... visa"
    String.raw`\b(?:valid|appropriate|suitable|relevant|current|eligible|approved)\s+(?:\w+\s+)?visa\b`,
    // "visa that allows / permits / with ... work|employment"
    String.raw`\bvisa\s+(?:that\s+|which\s+)?(?:allow|permit|entitl|with)\w*\b[^.;,\n]{0,40}\b(?:work|employ)`,
    // generic right to work: "the right to work in Australia", "legally entitled to work"
    String.raw`\bright\s+to\s+work\b`,
    String.raw`\b(?:entitled|eligible|authori[sz]ed|permitted)\s+to\s+work\b`,
    // "valid / appropriate ... work rights"
    String.raw`\b(?:valid|appropriate|suitable|sufficient|relevant|necessary)\s+(?:\w+\s+)?work(?:ing)?\s+rights\b`,
  ].join("|"),
  "i"
);

/** Wording that withdraws an option, or talks about sponsoring rather than accepting. */
const NEGATION_RE =
  /\b(?:not|no|never|cannot|can't|unable|unwilling|won't|without|excluding|except|ineligible)\b|n't\b|\bsponsor/i;

/** Application-document checklists, not eligibility. */
const DOCUMENT_CHECKLIST_RE =
  /\b(?:birth|citizenship)\s+certificate\b|\bproof\s+of\s+(?:\w+\s+)?(?:identity|citizenship)\b/i;

export type EligibilityAlternativeKind =
  "none" | "full_work_rights" | "any_visa" | "graduate_visa";

export type EligibilityClauseAnalysis = {
  /** Precedence: full_work_rights > any_visa > graduate_visa > none. */
  kind: EligibilityAlternativeKind;
  /** Exact substring of the ad for the winning alternative. */
  evidence?: EvidenceField;
};

type Segment = { start: number; end: number; text: string };

type Range = { start: number; end: number };

function lineBounds(adText: string, pos: number): Range {
  const start = adText.lastIndexOf("\n", Math.max(pos - 1, 0)) + 1;
  const nl = adText.indexOf("\n", pos);

  return {
    start: start > pos ? 0 : start,
    end: nl === -1 ? adText.length : nl,
  };
}

function isStatusSegment(text: string): boolean {
  return STATUS_RE.test(text) && !OTHER_COUNTRY_RE.test(text);
}

/**
 * Scope of the eligibility clause around `start..end`.
 *
 * A span inside a bullet widens to the whole adjacent bullet list (plus a
 * lead-in line ending in ":") when that list is disjunctive: a bullet ends in
 * "or", the list says "one of / any of / either", or two or more bullets name a
 * citizenship/PR status (those cannot all be required together).
 */
function findEligibilityScope(
  adText: string,
  start: number,
  end: number
): Range {
  const clauseStart = findClauseStart(adText, start);
  const clauseEnd = Math.max(findClauseEnd(adText, start, clauseStart), end);

  const isBullet = (line: Range) =>
    BULLET_LINE_RE.test(adText.slice(line.start, line.end));

  const own = lineBounds(adText, start);

  if (!isBullet(own)) {
    return { start: clauseStart, end: clauseEnd };
  }

  let first = own;
  while (first.start > 0) {
    const prev = lineBounds(adText, first.start - 1);
    if (!isBullet(prev)) break;
    first = prev;
  }

  let last = own;
  while (last.end < adText.length) {
    const next = lineBounds(adText, last.end + 1);
    if (!isBullet(next)) break;
    last = next;
  }

  let listStart = first.start;
  if (first.start > 0) {
    const lead = lineBounds(adText, first.start - 1);
    if (/:\s*$/.test(adText.slice(lead.start, lead.end))) {
      listStart = lead.start;
    }
  }

  const lines = adText.slice(listStart, last.end).split("\n");
  const disjunctive =
    lines.filter(isStatusSegment).length >= 2 ||
    lines.some((line) => /\b(?:one of|any of|either)\b/i.test(line)) ||
    lines.slice(0, -1).some((line) => /\bor[\s.,;]*$/i.test(line));

  if (!disjunctive) {
    return { start: clauseStart, end: clauseEnd };
  }

  return {
    start: Math.min(clauseStart, listStart),
    end: Math.max(clauseEnd, last.end),
  };
}

function splitIntoOptions(adText: string, scope: Range): Segment[] {
  const text = adText.slice(scope.start, scope.end);
  const segments: Segment[] = [];
  const separator = /,|;|\/|\r?\n|\band\/or\b|\bor\b/gi;

  let from = 0;

  const push = (to: number) => {
    let s = from;
    let e = to;

    const bullet = BULLET_LINE_RE.exec(text.slice(s, e));
    if (bullet) s += bullet[0].length;

    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /[\s.,;:]/.test(text[e - 1])) e--;

    if (e > s) {
      segments.push({
        start: scope.start + s,
        end: scope.start + e,
        text: text.slice(s, e),
      });
    }
  };

  for (const match of text.matchAll(separator)) {
    push(match.index);
    from = match.index + match[0].length;
  }

  push(text.length);

  return segments;
}

function segmentField(
  adText: string,
  seg: Segment,
  value: string
): EvidenceField {
  return {
    value,
    text: adText.slice(seg.start, seg.end),
    start: seg.start,
    end: seg.end,
  };
}

/**
 * Decides which alternative (if any) to citizenship / permanent residency the
 * clause around `field` offers. One mechanism owns the decision for a clause:
 * both the OR-clause suppression and the visa-pathway detection read this.
 */
export function analyseEligibilityClause(
  adText: string,
  field: EvidenceField | undefined
): EligibilityClauseAnalysis {
  if (!field) return { kind: "none" };

  const scope = findEligibilityScope(adText, field.start, field.end);
  const segments = splitIntoOptions(adText, scope);

  let fullRights: Segment | undefined;
  let anyVisa: Segment | undefined;
  let graduate: Segment | undefined;

  segments.forEach((seg, i) => {
    if (isStatusSegment(seg.text)) return;
    if (/^and\b/i.test(seg.text)) return;
    if (i > 0 && /\band\s*$/i.test(segments[i - 1].text)) return;
    if (NEGATION_RE.test(seg.text)) return;

    const isGraduate = GRADUATE_VISA_RE.test(seg.text);

    if (FULL_WORK_RIGHTS_RE.test(seg.text)) {
      fullRights ??= seg;
    } else if (
      STUDENT_VISA_RE.test(seg.text) ||
      (GENERIC_VISA_RE.test(seg.text) && !isGraduate)
    ) {
      anyVisa ??= seg;
    } else if (isGraduate) {
      graduate ??= seg;
    }
  });

  if (fullRights) {
    return {
      kind: "full_work_rights",
      evidence: segmentField(
        adText,
        fullRights,
        "Full working rights accepted"
      ),
    };
  }

  if (anyVisa) {
    return {
      kind: "any_visa",
      evidence: segmentField(
        adText,
        anyVisa,
        "Visa holders with work rights accepted"
      ),
    };
  }

  if (graduate) {
    return {
      kind: "graduate_visa",
      evidence: segmentField(
        adText,
        graduate,
        "Graduate visa (subclass 485) accepted"
      ),
    };
  }

  return { kind: "none" };
}

/**
 * True when the clause around `field` lists full / unrestricted working rights
 * as its own option next to citizenship / PR ("citizen, PR or full working
 * rights"). Does NOT fire when the phrase qualifies a status ("NZ citizen with
 * full working rights") or sits in another sentence or line.
 *
 * IMPORTANT: Does NOT populate temporaryVisaAllowed.
 */
export function hasFullWorkRightsAlternative(
  adText: string,
  field: EvidenceField | undefined
): boolean {
  return analyseEligibilityClause(adText, field).kind === "full_work_rights";
}

/**
 * True when the evidence sits in a document checklist
 * ("Passport or Birth Certificate or Australian Citizenship Certificate").
 */
export function isDocumentChecklistEvidence(
  adText: string,
  field: EvidenceField | undefined
): boolean {
  if (!field) return false;

  const scope = findEligibilityScope(adText, field.start, field.end);

  return (
    DOCUMENT_CHECKLIST_RE.test(adText.slice(scope.start, scope.end)) ||
    /^\s*certificate\b/i.test(adText.slice(field.end, field.end + 20))
  );
}

export type EligibilityClauseResolution = {
  citizenshipRequirement?: EvidenceField;
  residencyRequirement?: EvidenceField;
  /** Any visa with work rights (or a student visa) is accepted. */
  temporaryVisaAllowed?: EvidenceField;
  /** The only visa accepted next to citizenship / PR is a 485. */
  graduateVisaPathway?: EvidenceField;
};

/**
 * Reads the clause around the citizenship and residency evidence and returns
 * the evidence fields the rules engine should see.
 *
 *   - full working rights offered  -> citizenship / PR suppressed (the
 *     work-rights field then drives the profile-aware verdict)
 *   - any visa with work rights    -> temporaryVisaAllowed
 *   - only a 485 offered           -> graduateVisaPathway
 *   - otherwise                    -> citizenship / PR stay hard blockers
 *
 * Document checklists are dropped. Verdicts are NOT decided here.
 */
export function resolveEligibilityClause(
  adText: string,
  citizenship: EvidenceField | undefined,
  residency: EvidenceField | undefined
): EligibilityClauseResolution {
  let anyVisa: EvidenceField | undefined;
  let graduate: EvidenceField | undefined;

  const handle = (
    field: EvidenceField | undefined
  ): EvidenceField | undefined => {
    if (!field || isDocumentChecklistEvidence(adText, field)) return undefined;

    const analysis = analyseEligibilityClause(adText, field);

    if (analysis.kind === "full_work_rights") return undefined;
    if (analysis.kind === "any_visa") anyVisa ??= analysis.evidence;
    if (analysis.kind === "graduate_visa") graduate ??= analysis.evidence;

    return field;
  };

  return {
    citizenshipRequirement: handle(citizenship),
    residencyRequirement: handle(residency),
    temporaryVisaAllowed: anyVisa,
    graduateVisaPathway: anyVisa ? undefined : graduate,
  };
}

// --------------------------------------------------
// MODEL-INDEPENDENT STATUS EXTRACTION
//
// The model's citizenship / residency spans are validated against their own
// text, and a deterministic scan supplies a span when the model returns none,
// so the verdict does not hinge on what the model happened to extract.
// --------------------------------------------------

const CITIZEN_WORD_RE = /\bcitizen(?:s|ship)?\b/i;
const PERMANENT_RESIDENCY_RE = /\bpermanent\s+resid(?:ents?|ency|ence)\b/i;
/** Case-sensitive on purpose: "PR" the abbreviation, not "pr". */
const PR_ABBREVIATION_RE = /\bPRs?\b/;

/**
 * Keeps a residencyRequirement span only if its own text names permanent
 * residency. "residing in Australia" / "living in NSW" are location wording.
 */
export function filterResidencyRequirement(
  field: EvidenceField | undefined
): EvidenceField | undefined {
  if (!field) return undefined;

  return PERMANENT_RESIDENCY_RE.test(field.text) ||
    PR_ABBREVIATION_RE.test(field.text)
    ? field
    : undefined;
}

/** Keeps a citizenshipRequirement span only if its own text names citizenship. */
export function filterCitizenshipRequirement(
  field: EvidenceField | undefined
): EvidenceField | undefined {
  if (!field) return undefined;

  return CITIZEN_WORD_RE.test(field.text) ? field : undefined;
}

/** Cues that a sentence states a requirement or restriction. */
const REQUIREMENT_CUE_RE =
  /\b(?:must|need(?:s)?\s+to|should|have\s+to|required?|requirements?|mandatory|essential|eligib\w+|criteria|only|open\s+to|limited\s+to|restricted\s+to|available\s+to)\b/i;

/** A bullet that begins with status-style wording ("Be an ...", "Australian citizen"). */
const BULLET_STATUS_START_RE =
  /^(?:be|hold|are|have|an?|the|australian|new\s+zealand|nz|citizens?|permanent|PR)\b/i;

/** "no citizenship required", "regardless of citizenship". */
const STATUS_NEGATED_RE =
  /\b(?:no|not|without|regardless|irrespective|never)\b[^.]{0,60}\b(?:citizen\w*|permanent|PR)\b|\b(?:citizen\w*|permanent\s+resid\w+|PR)\b[^.]{0,40}\b(?:is\s+not|not|no)\s+(?:required|needed|necessary|essential|mandatory)\b/i;

/** Status as a future outcome or a benefit, not a prerequisite. */
const STATUS_NOT_PREREQUISITE_RE =
  /\b(?:secur\w+|obtain\w*|gain\w*|apply(?:ing)?\s+for|pathway|transition\w*|become|becoming|sponsor\w*|help\w*|assist\w*|support\w*)\b[^.]{0,60}\b(?:citizen\w*|permanent\s+resid\w+|PR)\b|\bpermanent\s+resid\w+\s+(?:applications?|pathways?|support|assistance)\b/i;

/** "be / hold ... citizen|permanent resident": a held-status statement. */
const STATUS_HELD_RE =
  /\b(?:be|being|hold|holding|holds|are|is)\b(?:\s+\S+){0,6}?\s+(?:citizens?|citizenship|permanent\s+resid\w+)/i;

type Unit = { start: number; end: number; text: string; bullet: boolean };

/** Splits the ad into bullets and sentences, with exact offsets. */
function splitIntoUnits(adText: string): Unit[] {
  const units: Unit[] = [];
  let lineStart = 0;

  for (const line of adText.split("\n")) {
    const bulletMatch = BULLET_LINE_RE.exec(line);
    const bodyFrom = bulletMatch ? bulletMatch[0].length : 0;
    const pieces: Array<[number, number]> = [];

    let from = bodyFrom;
    for (const m of line.matchAll(/[.!?]+(?=\s|$)/g)) {
      if (m.index < from) continue;
      pieces.push([from, m.index]);
      from = m.index + m[0].length;
    }
    pieces.push([from, line.length]);

    pieces.forEach(([pieceFrom, pieceTo], i) => {
      let s = pieceFrom;
      let e = pieceTo;
      // Skip whitespace and leading markdown emphasis; trim trailing punctuation.
      while (s < e && /[\s*_]/.test(line[s])) s++;
      while (e > s && /[\s.,;:*_]/.test(line[e - 1])) e--;
      if (e > s) {
        units.push({
          start: lineStart + s,
          end: lineStart + e,
          text: line.slice(s, e),
          bullet: Boolean(bulletMatch) && i === 0,
        });
      }
    });

    lineStart += line.length + 1;
  }

  return units;
}

function isRequirementUnit(unit: Unit): boolean {
  const { text } = unit;

  const hasStatus =
    CITIZEN_WORD_RE.test(text) ||
    PERMANENT_RESIDENCY_RE.test(text) ||
    (PR_ABBREVIATION_RE.test(text) && /\b(?:citizen|resident|visa)/i.test(text));

  if (!hasStatus) return false;
  if (OTHER_COUNTRY_RE.test(text) && !/\bAustralia/i.test(text)) return false;
  if (DOCUMENT_CHECKLIST_RE.test(text)) return false;
  if (STATUS_NEGATED_RE.test(text) || STATUS_NOT_PREREQUISITE_RE.test(text)) {
    return false;
  }

  return (
    REQUIREMENT_CUE_RE.test(text) ||
    STATUS_HELD_RE.test(text) ||
    (unit.bullet && BULLET_STATUS_START_RE.test(text))
  );
}

/**
 * Finds the first sentence / bullet that states a citizenship or permanent
 * residency prerequisite, without any model input. The returned span is the
 * whole sentence or bullet, so resolveEligibilityClause can read the
 * alternatives next to it.
 */
export function scanEligibilityStatus(adText: string): {
  citizenship?: EvidenceField;
  residency?: EvidenceField;
} {
  let citizenship: EvidenceField | undefined;
  let residency: EvidenceField | undefined;

  for (const unit of splitIntoUnits(adText)) {
    if (citizenship && residency) break;
    if (!isRequirementUnit(unit)) continue;

    const span = (value: string): EvidenceField => ({
      value,
      text: unit.text,
      start: unit.start,
      end: unit.end,
    });

    if (!citizenship && CITIZEN_WORD_RE.test(unit.text)) {
      citizenship = span("Australian citizenship required");
    }

    if (
      !residency &&
      (PERMANENT_RESIDENCY_RE.test(unit.text) ||
        PR_ABBREVIATION_RE.test(unit.text))
    ) {
      residency = span("Australian permanent residency required");
    }
  }

  return { citizenship, residency };
}

/**
 * Model span (validated) -> narrow fallback -> deterministic scan, then clause
 * analysis. Verdicts are still decided only in rules.ts.
 */
export function resolveEligibilityStatus(
  adText: string,
  modelCitizenship: EvidenceField | undefined,
  modelResidency: EvidenceField | undefined
): EligibilityClauseResolution {
  const usable = (field: EvidenceField | undefined) =>
    field && !isDocumentChecklistEvidence(adText, field) ? field : undefined;

  const citizenship =
    usable(filterCitizenshipRequirement(modelCitizenship)) ??
    fallbackCitizenship(adText);

  const residency =
    usable(filterResidencyRequirement(modelResidency)) ??
    fallbackResidency(adText);

  const scan =
    citizenship && residency ? {} : scanEligibilityStatus(adText);

  return resolveEligibilityClause(
    adText,
    citizenship ?? scan.citizenship,
    residency ?? scan.residency
  );
}

export function filterTemporaryVisaAllowed(
  field: EvidenceField | undefined
): EvidenceField | undefined {
  if (!field) return undefined;

  const text = field.text.toLowerCase();

  // Reject generic diversity/inclusion wording
  if (
    /\b(nationalities|people (?:of|from) all backgrounds|international culture|diversity|inclusion)\b/i.test(
      text
    )
  ) {
    return undefined;
  }

  // Reject explicitly negative, unavailable, or screening language
  if (
    /\b(?:not available|cannot sponsor|no (?:visa )?sponsorship|sponsorship (?:is )?unavailable|visa required|what visa do you currently hold)\b/i.test(
      text
    )
  ) {
    return undefined;
  }

  // Require positive eligibility/consideration semantics.
  // Mere presence of "visa", "sponsor", or "sponsorship" is insufficient.
  const positivePattern =
    /\b(?:temporary visa holders?|appropriate visa that allows|citizen of another country|sponsorship (?:is )?(?:available|offered|provided)|offer sponsor(?:ship)?|we (?:can|will) sponsor)\b/i;

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
