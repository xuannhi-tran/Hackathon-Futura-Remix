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

  // "No span, no claim":
  // discard evidence if Gemini
  // did not return an exact substring.

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
  
  Examples:
  - "Sydney NSW"
  - "Melbourne VIC"
  
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
  
  Extract the phrase that best identifies the professional role or field.
  
  Examples:
  - "Software Engineer"
  - "Data Analyst"
  - "Marketing Coordinator"
  - "Mechanical Engineer"
  - "Data Scientist"
  
  For roleField:
  - text must still be an exact substring from the advertisement.
  - value may normalise the field name, for example:
    text: "Junior Software Engineer"
    value: "Software Engineering"
  
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

      location: addEvidenceSpan(adText, rawExtraction.location),

      workRightsRequirement: addEvidenceSpan(
        adText,
        rawExtraction.workRightsRequirement
      ),

      australianExperienceRequirement: addEvidenceSpan(
        adText,
        rawExtraction.australianExperienceRequirement
      ),

      roleField: addEvidenceSpan(adText, rawExtraction.roleField),
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
