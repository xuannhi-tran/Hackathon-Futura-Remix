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

  // No span, no claim:
  // discard Gemini evidence if it is not
  // an exact substring of the original ad.
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
// DETERMINISTIC FALLBACK — LOCATION
// --------------------------------------------------

function fallbackLocation(adText: string): EvidenceField | undefined {
  // Prefer an explicitly labelled line:
  //
  // Location: Sydney NSW
  //
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

  // Common explicit Australian city/state format.
  //
  // Example: Sydney NSW
  //
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

  // Only accept first line if it looks like
  // a genuine job title.
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
    const body = await request.json();

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

Examples:
- "Australian citizen"
- "Australian citizenship required"

residencyRequirement

Examples:
- "permanent residents only"
- "permanent residency required"

securityClearance

Examples:
- "Baseline security clearance"
- "NV1 clearance"

sponsorship

Examples:
- "no sponsorship available"
- "visa sponsorship provided"

employmentType

Examples:
- "permanent full-time"
- "part-time"
- "casual"

hoursPerWeek

Examples:
- "38 hours per week"
- "24 hours weekly"

registration

Examples:
- "AHPRA registration required"
- "CPA qualification"

yearsExperience

Examples:
- "minimum 3 years experience"
- "2+ years of experience"

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

Examples:
- "full working rights"
- "unrestricted working rights"
- "full Australian working rights"

australianExperienceRequirement

Examples:
- "Australian experience required"
- "local experience essential"
- "previous Australian work experience"

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

    const rawExtraction = JSON.parse(response.text) as RawExtraction;

    // ------------------------------------------
    // Validate AI spans first.
    // ------------------------------------------

    const aiLocation = addEvidenceSpan(adText, rawExtraction.location);

    const aiRoleField = addEvidenceSpan(adText, rawExtraction.roleField);

    // ------------------------------------------
    // Final structured extraction
    // ------------------------------------------

    const extraction = {
      citizenshipRequirement: addEvidenceSpan(
        adText,
        rawExtraction.citizenshipRequirement
      ),

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

      registration: addEvidenceSpan(adText, rawExtraction.registration),

      yearsExperience: addEvidenceSpan(adText, rawExtraction.yearsExperience),

      location: aiLocation ?? fallbackLocation(adText),

      workRightsRequirement: addEvidenceSpan(
        adText,
        rawExtraction.workRightsRequirement
      ),

      australianExperienceRequirement: addEvidenceSpan(
        adText,
        rawExtraction.australianExperienceRequirement
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
