import { GoogleGenAI, Type } from "@google/genai";

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

const evidenceSchema = {
  type: Type.OBJECT,

  properties: {
    value: {
      type: Type.STRING,
    },

    text: {
      type: Type.STRING,
      description:
        "Exact substring copied character-for-character from the original job advertisement.",
    },
  },

  required: ["value", "text"],
};

const extractionSchema = {
  type: Type.OBJECT,

  properties: {
    citizenshipRequirement: evidenceSchema,
    residencyRequirement: evidenceSchema,
    securityClearance: evidenceSchema,

    sponsorship: evidenceSchema,
    employmentType: evidenceSchema,
    hoursPerWeek: evidenceSchema,
    registration: evidenceSchema,
    yearsExperience: evidenceSchema,
    location: evidenceSchema,

    workRightsRequirement: evidenceSchema,
    australianExperienceRequirement: evidenceSchema,

    temporaryVisaAllowed: evidenceSchema,
    visaPlanRequirement: evidenceSchema,

    roleField: evidenceSchema,
  },
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
// DETERMINISTIC FALLBACK — CITIZENSHIP
// --------------------------------------------------

function fallbackCitizenship(adText: string): EvidenceField | undefined {
  const patterns = [
    /\bBe an Australian citizen(?: at the time of application)?\b/i,

    /\bAustralian Citizenship is mandatory\b/i,

    /\bAustralian citizenship (?:is )?(?:required|mandatory|essential)\b/i,

    /\bmust be an? Australian citizen\b/i,

    /\bAustralian citizen(?:ship)? required\b/i,

    /\bapplicants must be Australian citizens?\b/i,
  ];

  for (const pattern of patterns) {
    const match = adText.match(pattern);

    if (match && match.index !== undefined) {
      return {
        value: "Australian citizenship required",
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
      };
    }
  }

  return undefined;
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

// --------------------------------------------------
// DETERMINISTIC FALLBACK — LOCATION
// --------------------------------------------------

function fallbackLocation(adText: string): EvidenceField | undefined {
  const labelledMatch = adText.match(/(?:^|\n)\s*Location:\s*([^\n\r]+)/i);

  if (labelledMatch) {
    const text = labelledMatch[1].trim();

    const searchFrom = labelledMatch.index ?? 0;

    const start = adText.indexOf(text, searchFrom);

    if (start !== -1) {
      return {
        value: text,
        text,
        start,
        end: start + text.length,
      };
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
// DETERMINISTIC FALLBACK — PROFESSIONAL REGISTRATION
// --------------------------------------------------

function fallbackRegistration(adText: string): EvidenceField | undefined {
  const patterns = [
    /\bCurrent Registered Nurse registration \(AHPRA\)\b/i,

    /\bcurrent AHPRA registration\b/i,

    /\bAHPRA registration\b/i,

    /\bregistered with AHPRA\b/i,

    /\beligible for admission in (?:Queensland|NSW|Victoria|WA|SA|TAS|ACT)\b/i,

    /\bAustralian legal practising certificate\b/i,
  ];

  for (const pattern of patterns) {
    const match = adText.match(pattern);

    if (match && match.index !== undefined) {
      return {
        value: "Professional registration requirement",
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
      };
    }
  }

  return undefined;
}

// --------------------------------------------------
// DETERMINISTIC FALLBACK — TEMPORARY VISA ALLOWED
// --------------------------------------------------

function fallbackTemporaryVisaAllowed(
  adText: string
): EvidenceField | undefined {
  const patterns = [
    /\btemporary visa that allows you to live and work in Australia, you may be offered employment in line with the conditions of your visa\b/i,

    /\bcitizen of another country with an appropriate visa that allows you to work in Australia\b/i,

    /\btemporary visa\b[^\n\r.]{0,180}\bmay be offered employment\b[^\n\r.]*/i,
  ];

  for (const pattern of patterns) {
    const match = adText.match(pattern);

    if (match && match.index !== undefined) {
      return {
        value: "Temporary visa holders explicitly allowed",
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
      };
    }
  }

  return undefined;
}

// --------------------------------------------------
// DETERMINISTIC FALLBACK — ROLE FIELD
// --------------------------------------------------

function fallbackRoleField(adText: string): EvidenceField | undefined {
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

export async function POST(request: Request) {
  try {
    let body: {
      adText?: unknown;
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

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    const prompt = `
You are an information extraction system for Australian job advertisements.

Extract ONLY information that is explicitly stated in the job advertisement.

Do not decide whether the candidate should apply.

Do not provide visa advice.

Do not infer requirements that are not written in the advertisement.

For every extracted field:

- "text" MUST be copied exactly, character-for-character, from the original advertisement.

- Use the smallest meaningful phrase that proves the requirement or identifies the requested information.

- "value" should be a short normalised description of what that phrase means.

- If a field is not explicitly present, omit that field entirely.

Extract these fields where present:

citizenshipRequirement

Extract an explicit requirement for Australian citizenship.

Examples:
- "Australian citizen"
- "Australian citizenship required"
- "Australian Citizenship is mandatory"
- "must be an Australian citizen"

IMPORTANT:
If the advertisement explicitly says citizenship is mandatory,
required, essential, or that applicants must be Australian citizens,
you MUST extract citizenshipRequirement.

Do not classify explicit Australian citizenship requirements
as workRightsRequirement.

residencyRequirement

Examples:
- "permanent residents only"
- "permanent residency required"
- "Australian citizen or permanent resident"

securityClearance

Examples:
- "Baseline security clearance"
- "NV1 clearance"
- "Negative Vetting Level 2"
- "Australian Government security clearance"

sponsorship

Extract explicit statements about visa sponsorship.

Examples:
- "no sponsorship available"
- "visa sponsorship is not available"
- "We are not able to sponsor"
- "cannot sponsor people"
- "cannot sponsor visas"
- "visa sponsorship provided"

Do not infer sponsorship policy when it is not stated.

employmentType

Examples:
- "permanent full-time"
- "permanent full time"
- "part-time"
- "casual"

hoursPerWeek

Examples:
- "38 hours per week"
- "24 hours weekly"

registration

Extract an explicitly stated professional registration, professional admission,
practising certificate, or equivalent qualification requirement.

Examples:
- "current AHPRA registration required"
- "AHPRA registration is essential"
- "Current Registered Nurse registration (AHPRA)"
- "Implied requirement: Current Registered Nurse registration (AHPRA)"
- "eligible for admission in Queensland"
- "Australian legal practising certificate"
- "CPA qualification"

If the advertisement itself explicitly contains wording such as
"Implied requirement: Current Registered Nurse registration (AHPRA)",
this is still explicit evidence in the source text and should be extracted.

Only extract registration when the advertisement explicitly contains
registration, admission, certification, or practising-certificate wording.

Do NOT infer registration merely from a job title such as:
- "Registered Nurse"
- "Law Graduate"
- "Accountant"

Do NOT extract:
- optional qualifications
- example answers
- application form labels
- background information that merely mentions registration

yearsExperience

Examples:
- "minimum 3 years experience"
- "2+ years of experience"
- "2 years of software development experience"

location

If the advertisement explicitly states a job location,
extract the most specific location phrase.

Look especially for labelled fields such as:
- "Location: Sydney NSW"
- "Location: Melbourne VIC"

Also recognise explicit phrases such as:
- "based in Sydney NSW"
- "our Melbourne VIC office"

For location:
- "text" MUST be the exact location substring from the advertisement.
- "value" should contain the normalised location.
- Do not infer a location if none is explicitly stated.

workRightsRequirement

Extract ONLY explicit candidate work-right requirements.

Examples of genuine requirements:
- "full working rights"
- "unrestricted working rights"
- "full Australian working rights"
- "must be legally entitled to work"
- "must have a valid visa with full work rights"
- "must have the right to work in Australia"

Do NOT extract application-form or screening questions.

Examples that MUST NOT be extracted:
- "Do you have the right to work in Australia?"
- "Which statement best describes your right to work in Australia?"
- "Which of the following best describes your right to work in Australia?"
- "What is your current right to work status in Australia?"

A question asking the applicant to describe their work-right status
is not itself an eligibility requirement.

Also do NOT classify explicit Australian citizenship requirements
as workRightsRequirement.

australianExperienceRequirement

Examples:
- "Australian experience required"
- "local experience essential"
- "previous Australian work experience"

temporaryVisaAllowed

Extract explicit wording showing that temporary visa holders,
international candidates with an appropriate visa,
or candidates from another country with suitable work rights
may be considered.

Examples:
- "temporary visa holders may be offered employment"
- "temporary visa holders may apply"
- "temporary visa with appropriate working rights"
- "temporary visa that allows you to live and work in Australia, you may be offered employment in line with the conditions of your visa"
- "citizen of another country with an appropriate visa that allows you to work in Australia"

This field is IMPORTANT because explicit temporary-visa acceptance
can change how blocker-shaped wording should be interpreted.

For temporaryVisaAllowed:
- "text" MUST be exact wording from the advertisement.
- Only extract this field when temporary visa eligibility is stated explicitly.
- Do not infer it from generic diversity statements.
- Do not infer it merely because sponsorship is mentioned.

visaPlanRequirement

Extract explicit wording where the employer asks a student visa holder
or temporary visa holder to explain, document, or outline future visa plans.

Examples:
- "proposed next visa plans"
- "outline your visa plan"
- "brief document outlining proposed next visa plan"
- "provide details of your proposed visa pathway"

For visaPlanRequirement:
- Extract only explicit requirements or requests concerning future visa plans.
- Do not extract a generic question asking what visa the candidate currently holds.

roleField

This field is HIGH PRIORITY.

If the advertisement contains an explicit job title or role title,
you MUST extract roleField.

Use the most specific explicit job title written in the advertisement.

Examples:
- "Graduate Software Engineer"
- "Junior Software Engineer"
- "Data Analyst"
- "Marketing Coordinator"
- "Mechanical Engineer"
- "Data Scientist"

For roleField:
- "text" MUST be the exact job title substring copied from the advertisement.
- "value" should be the normalised professional field.

Examples:

text: "Graduate Software Engineer"
value: "Software Engineering"

text: "Junior Data Analyst"
value: "Data Analytics"

Do not omit roleField when an explicit job title is present.

Do not infer a field if no job title or professional role is explicitly stated.

JOB ADVERTISEMENT:

${adText}
    `.trim();

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",

      contents: prompt,

      config: {
        temperature: 0,

        responseMimeType: "application/json",

        responseSchema: extractionSchema,
      },
    });

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

    let rawExtraction: RawExtraction;

    try {
      rawExtraction = JSON.parse(response.text) as RawExtraction;
    } catch (error) {
      console.error("Invalid Gemini JSON:", response.text);

      console.error("Gemini JSON parse error:", error);

      // Continue with deterministic fallbacks.
      rawExtraction = {};
    }

    // ------------------------------------------
    // Validate AI spans first.
    // ------------------------------------------

    const aiCitizenship = addEvidenceSpan(
      adText,
      rawExtraction.citizenshipRequirement
    );

    const aiLocation = addEvidenceSpan(adText, rawExtraction.location);

    const aiRegistration = addEvidenceSpan(adText, rawExtraction.registration);

    const aiTemporaryVisaAllowed = addEvidenceSpan(
      adText,
      rawExtraction.temporaryVisaAllowed
    );

    const aiWorkRights = filterWorkRightsRequirement(
      addEvidenceSpan(adText, rawExtraction.workRightsRequirement)
    );

    const aiRoleField = addEvidenceSpan(adText, rawExtraction.roleField);

    // ------------------------------------------
    // Final structured extraction
    // ------------------------------------------

    const extraction = {
      citizenshipRequirement: aiCitizenship ?? fallbackCitizenship(adText),

      residencyRequirement: addEvidenceSpan(
        adText,
        rawExtraction.residencyRequirement
      ),

      securityClearance: addEvidenceSpan(
        adText,
        rawExtraction.securityClearance
      ),

      sponsorship: addEvidenceSpan(adText, rawExtraction.sponsorship),

      employmentType: addEvidenceSpan(adText, rawExtraction.employmentType),

      hoursPerWeek: addEvidenceSpan(adText, rawExtraction.hoursPerWeek),

      registration: aiRegistration ?? fallbackRegistration(adText),

      yearsExperience: addEvidenceSpan(adText, rawExtraction.yearsExperience),

      location: aiLocation ?? fallbackLocation(adText),

      workRightsRequirement: aiWorkRights,

      australianExperienceRequirement: addEvidenceSpan(
        adText,
        rawExtraction.australianExperienceRequirement
      ),

      temporaryVisaAllowed:
        aiTemporaryVisaAllowed ?? fallbackTemporaryVisaAllowed(adText),

      visaPlanRequirement: addEvidenceSpan(
        adText,
        rawExtraction.visaPlanRequirement
      ),

      roleField: aiRoleField ?? fallbackRoleField(adText),
    };

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
