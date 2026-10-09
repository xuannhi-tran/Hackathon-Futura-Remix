import { GoogleGenAI } from "@google/genai";

import {
  fallbackSecurityClearance,
  fallbackTemporaryVisaAllowed,
  fallbackLocation,
  fallbackRegistration,
  fallbackVisaPlanRequirement,
  fallbackRoleField,
  resolveEligibilityStatus,
  fallbackWorkRightsRequirement,
  filterTemporaryVisaAllowed,
} from "../../../lib/extractionFallbacks";

import {
  enforceClientLimit,
  geminiFailureResponse,
  isEvalBypass,
  readCachedExtraction,
  reserveGeminiCall,
  writeCachedExtraction,
} from "../../../lib/geminiGuard";

import {
  EXTRACT_MODEL,
  buildExtractionPrompt,
  extractionSchema,
} from "../../../lib/extractPrompt";

import { describeVerdict, trackServer } from "../../../lib/analytics";
import { adLengthBucket } from "../../../lib/analyticsSchema";

import { extractTitle } from "../../../lib/titleExtraction";

type RawEvidenceField = {
  value: string;
  text: string;
};

type EvidenceField = RawEvidenceField & {
  start: number;
  end: number;
};

type RawExtraction = {
  citizenshipRequirement?: RawEvidenceField;
  residencyRequirement?: RawEvidenceField;
  securityClearance?: RawEvidenceField;

  sponsorship?: RawEvidenceField;
  employmentType?: RawEvidenceField;
  hoursPerWeek?: RawEvidenceField;
  registration?: RawEvidenceField;
  yearsExperience?: RawEvidenceField;
  location?: RawEvidenceField;

  workRightsRequirement?: RawEvidenceField;
  australianExperienceRequirement?: RawEvidenceField;

  // Quan rules integration
  temporaryVisaAllowed?: RawEvidenceField;
  visaPlanRequirement?: RawEvidenceField;

  // Tier 3
  roleField?: RawEvidenceField;
};

function addEvidenceSpan(
  adText: string,
  field?: RawEvidenceField
): EvidenceField | undefined {
  if (!field) {
    return undefined;
  }

  const start = adText.indexOf(field.text);

  // No span, no claim.
  if (start === -1) {
    console.warn(`Discarding invalid evidence text: "${field.text}"`);

    return undefined;
  }

  return {
    value: field.value,
    text: field.text,
    start,
    end: start + field.text.length,
  };
}

// --------------------------------------------------
// WORK-RIGHTS EVIDENCE FILTER
// --------------------------------------------------

function filterWorkRightsRequirement(
  field?: EvidenceField
): EvidenceField | undefined {
  if (!field) {
    return undefined;
  }

  const text = field.text.trim().toLowerCase();

  // Generic application / screening questions are
  // not actual eligibility requirements.
  const screeningQuestionPatterns = [
    /which statement best describes your right to work in australia/i,
    /do you have (?:the )?right to work in australia/i,
    /what is your (?:current )?right to work(?: status)? in australia/i,
    /which of the following best describes your (?:current )?right to work/i,
    /are you legally entitled to work in australia\?/i,
  ];

  const isScreeningQuestion = screeningQuestionPatterns.some((pattern) =>
    pattern.test(text)
  );

  // Sometimes Gemini puts an explicit citizenship requirement
  // into workRightsRequirement instead of citizenshipRequirement.
  const misclassifiedCitizenship =
    /\baustralian citizen(?:ship)?\b/i.test(field.text) &&
    (/\bmust\b/i.test(field.text) ||
      /\brequired\b/i.test(field.text) ||
      /\bmandatory\b/i.test(field.text) ||
      /\bessential\b/i.test(field.text) ||
      /^\s*be an australian citizen/i.test(field.text));

  if (isScreeningQuestion) {
    console.warn(
      `Discarding screening-question work-right evidence: "${field.text}"`
    );

    return undefined;
  }

  if (misclassifiedCitizenship) {
    console.warn(
      `Discarding misclassified citizenship evidence from work-right field: "${field.text}"`
    );

    return undefined;
  }

  return field;
}

export async function POST(request: Request) {
  const startedAt = Date.now();

  try {
    let body: {
      adText?: unknown;
      // Structured visa profile; only used to describe the verdict in analytics.
      visaProfile?: unknown;
    };

    try {
      body = await request.json();
    } catch (error) {
      console.error("Invalid request JSON:", error);

      return Response.json(
        {
          error: "Request body must be valid JSON.",
        },
        {
          status: 400,
        }
      );
    }

    const adText = body.adText;

    if (!adText || typeof adText !== "string") {
      return Response.json(
        {
          error: "adText is required.",
        },
        {
          status: 400,
        }
      );
    }

    if (!process.env.GEMINI_API_KEY) {
      return Response.json(
        {
          error: "GEMINI_API_KEY is not configured.",
        },
        {
          status: 500,
        }
      );
    }

    const bypass = isEvalBypass(request);

    let cacheHit = false;
    let degraded = false;

    // Raw model output only: post-processing below always runs on it, so a
    // change to the fallbacks takes effect even for cached ads.
    let rawExtraction: RawExtraction | undefined = bypass
      ? undefined
      : ((await readCachedExtraction(adText)) as RawExtraction | null) ??
        undefined;

    if (rawExtraction) {
      cacheHit = true;
    } else {
      // Only requests that would call Gemini count against the limits.
      const limited =
        (await enforceClientLimit(request)) ?? (await reserveGeminiCall());

      if (limited) {
        trackServer(request, "request_refused", {
          reason: limited.status === 429 ? "rate_limited" : "quota_cap",
          route: "extract",
        });

        return limited;
      }

      const ai = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
      });

      let response;

      try {
        response = await ai.models.generateContent({
          model: EXTRACT_MODEL,

          contents: buildExtractionPrompt(adText),

          config: {
            temperature: 0,

            responseMimeType: "application/json",

            responseSchema: extractionSchema,
          },
        });
      } catch (error) {
        const busy = geminiFailureResponse(error);

        if (busy) {
          console.error("Gemini unavailable:", error);

          trackServer(request, "request_refused", {
            reason: "upstream_error",
            route: "extract",
          });

          return busy;
        }

        throw error;
      }

      if (!response.text) {
        return Response.json(
          {
            error: "Gemini returned an empty response.",
          },
          {
            status: 502,
          }
        );
      }

      try {
        rawExtraction = JSON.parse(response.text) as RawExtraction;

        if (!bypass) {
          await writeCachedExtraction(
            adText,
            rawExtraction as Record<string, unknown>
          );
        }
      } catch (error) {
        console.error("Invalid Gemini JSON:", response.text);

        console.error("Gemini JSON parse error:", error);

        // Continue with deterministic fallbacks. Not cached.
        rawExtraction = {};
        degraded = true;
      }
    }

    // ------------------------------------------
    // Validate AI spans first.
    // ------------------------------------------

    const aiCitizenship = addEvidenceSpan(
      adText,
      rawExtraction.citizenshipRequirement
    );

    const aiResidency = addEvidenceSpan(
      adText,
      rawExtraction.residencyRequirement
    );

    const aiSecurityClearance = addEvidenceSpan(
      adText,
      rawExtraction.securityClearance
    );

    const aiLocation = addEvidenceSpan(adText, rawExtraction.location);

    const aiRegistration = addEvidenceSpan(adText, rawExtraction.registration);

    const aiTemporaryVisaAllowed = filterTemporaryVisaAllowed(
      addEvidenceSpan(adText, rawExtraction.temporaryVisaAllowed)
    );

    const aiVisaPlanRequirement = addEvidenceSpan(
      adText,
      rawExtraction.visaPlanRequirement
    );

    const aiWorkRights = filterWorkRightsRequirement(
      addEvidenceSpan(adText, rawExtraction.workRightsRequirement)
    );

    const aiRoleField = addEvidenceSpan(adText, rawExtraction.roleField);

    // ------------------------------------------
    // Eligibility-clause resolution.
    //
    // Reads the clause around the citizenship / residency evidence and
    // decides which statuses it accepts:
    //   - "citizen, PR OR full working rights" -> citizenship / PR
    //     suppressed so the work-right field drives the verdict
    //   - "citizen, PR OR <any visa with work rights>" -> temporaryVisaAllowed
    //   - "citizen, PR OR Graduate Visa 485" -> graduateVisaPathway
    //   - document checklists are dropped
    // The verdict itself is still decided only in rules.ts.
    // ------------------------------------------

    // Model spans are validated against their own text (a residency span
    // must name permanent residency), then fall back to the narrow patterns
    // and finally to a deterministic sentence/bullet scan, so a missed model
    // span cannot turn a blocker into APPLY.
    const clause = resolveEligibilityStatus(
      adText,
      aiCitizenship,
      aiResidency
    );

    // Ensure work-right evidence is present when citizenship/residency are
    // suppressed — the fallback picks up explicit full/unrestricted phrases
    // that Gemini may have missed.
    const resolvedWorkRights =
      aiWorkRights ?? fallbackWorkRightsRequirement(adText);

    // ------------------------------------------
    // Final structured extraction
    // ------------------------------------------

    const extraction = {
      citizenshipRequirement: clause.citizenshipRequirement,

      residencyRequirement: clause.residencyRequirement,

      securityClearance:
        aiSecurityClearance ?? fallbackSecurityClearance(adText),

      sponsorship: addEvidenceSpan(adText, rawExtraction.sponsorship),

      employmentType: addEvidenceSpan(adText, rawExtraction.employmentType),

      hoursPerWeek: addEvidenceSpan(adText, rawExtraction.hoursPerWeek),

      registration: aiRegistration ?? fallbackRegistration(adText),

      yearsExperience: addEvidenceSpan(adText, rawExtraction.yearsExperience),

      location: aiLocation ?? fallbackLocation(adText),

      workRightsRequirement: resolvedWorkRights,

      australianExperienceRequirement: addEvidenceSpan(
        adText,
        rawExtraction.australianExperienceRequirement
      ),

      temporaryVisaAllowed:
        aiTemporaryVisaAllowed ??
        fallbackTemporaryVisaAllowed(adText) ??
        clause.temporaryVisaAllowed,

      graduateVisaPathway: clause.graduateVisaPathway,

      visaPlanRequirement:
        aiVisaPlanRequirement ?? fallbackVisaPlanRequirement(adText),

      roleField: aiRoleField ?? fallbackRoleField(adText),

      title: extractTitle(adText),
    };

    trackServer(request, "analyse_job", {
      ...describeVerdict(extraction, body.visaProfile),
      cacheHit,
      degraded,
      latencyMs: Date.now() - startedAt,
      adLengthBucket: adLengthBucket(adText.length),
    });

    return Response.json({
      extraction,
    });
  } catch (error) {
    console.error("Gemini extraction error:", error);

    return Response.json(
      {
        error: "Failed to extract job advertisement.",
      },
      {
        status: 500,
      }
    );
  }
}
