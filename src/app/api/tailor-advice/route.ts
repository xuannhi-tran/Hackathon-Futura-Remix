import { GoogleGenAI, Type } from "@google/genai";
import { Verdict, VisaProfile, FitProfile } from "../../../types/job";

const adviceSchema = {
  type: Type.OBJECT,
  properties: {
    summary: {
      type: Type.STRING,
      description:
        "A one or two sentence summary of the tailored advice based on the deterministic reason.",
    },
    checks: {
      type: Type.ARRAY,
      description:
        "A list of checks or confirmations the applicant should make.",
      items: { type: Type.STRING },
    },
    applicationTips: {
      type: Type.ARRAY,
      description:
        "A list of actionable tips on how to tailor their application for this specific role.",
      items: { type: Type.STRING },
    },
    recruiterQuestions: {
      type: Type.ARRAY,
      description:
        "A list of questions they could ask the recruiter or employer to clarify the job requirements.",
      items: { type: Type.STRING },
    },
  },
  required: ["summary", "checks", "applicationTips", "recruiterQuestions"],
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { adText, verdict, visaProfile, fitProfile } = body as {
      adText?: string;
      verdict?: Verdict;
      visaProfile?: VisaProfile;
      fitProfile?: FitProfile;
    };

    if (!adText || !verdict) {
      return Response.json(
        { error: "Missing required fields (adText, verdict)." },
        { status: 400 }
      );
    }

    if (verdict.status !== "TAILOR") {
      return Response.json(
        { error: "Tailor advice is only available for TAILOR verdicts." },
        { status: 400 }
      );
    }

    const ai = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    const prompt = `
You are a career advisory assistant for international students and recent graduates in Australia.
The user is considering applying for the job advertisement below.

Our deterministic eligibility engine has already returned a "TAILOR" verdict.
Your ONLY job is to provide contextual advice for this specific TAILOR verdict.

CRITICAL INSTRUCTIONS:
- You MUST NOT decide APPLY / TAILOR / SKIP. The decision is already TAILOR.
- You MUST NOT override the verdict or reinterpret the rules.
- You MUST NOT claim that the user is legally eligible or legally ineligible.
- You MUST NOT provide migration advice or state migration law as fact. Avoid phrases like "ensure you can meet visa work-hour limits and obligations", and prefer phrases like "confirm how the employer's stated work-right requirement applies to your current circumstances."
- This is "Decision support only — not migration advice."
- Do not claim the user definitely qualifies.

STRICT GROUNDING RULES:
1. Every factual statement about the employer, role, hours, employment type, location, field, sponsorship, visa requirements, or application process MUST be directly supported by the supplied job ad.
2. Never infer full-time or part-time status, occupation / role field, working hours, location, sponsorship availability, or employer visa policy unless explicitly stated in the supplied job ad.
3. If information is unknown, explicitly frame it as something to confirm with the employer.
4. Do not tell the user to put their visa subclass on their CV/application unless the advertisement explicitly asks for visa/work-right information. Prefer wording such as: "If the application asks about work rights, answer clearly and accurately based on your current status."
5. Questions to recruiters may ASK about unknown information, but must not imply that the unknown fact is already true.
6. Use only information contained in the provided job advertisement, the deterministic verdict reason, and the user profile.
7. Reference the specific requirement or evidence highlighted in the verdict.
8. Do NOT generate fake quotations from the job advertisement.

USER PROFILE:
- Visa Subclass: ${visaProfile?.subclass ?? "Not specified"}
- During Study Term: ${visaProfile?.duringStudyTerm ? "Yes" : "No"}
- Target Field: ${fitProfile?.targetField ?? "Not specified"}

DETERMINISTIC VERDICT REASON:
"${verdict.reason}"

EVIDENCE FOUND IN AD:
"${verdict.evidence?.text ?? "No specific evidence cited"}"

Provide your advice structured EXACTLY as the requested JSON schema. Focus your advice specifically on addressing the DETERMINISTIC VERDICT REASON. Answer:
1. What should the applicant check or confirm?
2. How can they tailor their application?
3. What could they ask the recruiter/employer?

JOB ADVERTISEMENT:
${adText}
`.trim();

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: prompt,
      config: {
        temperature: 0.1,
        responseMimeType: "application/json",
        responseSchema: adviceSchema,
      },
    });

    if (!response.text) {
      throw new Error("Empty response from Gemini.");
    }

    const advice = JSON.parse(response.text);

    return Response.json({ advice });
  } catch (error) {
    console.error("Gemini tailor advice error:", error);

    return Response.json(
      { error: "Failed to generate tailor advice." },
      { status: 500 }
    );
  }
}
