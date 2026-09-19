import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "../../app/api/tailor-advice/route";

const generateContentMock = vi.fn();

vi.mock("@google/genai", () => {
  return {
    GoogleGenAI: class {
      models = {
        generateContent: generateContentMock,
      };
    },
    Type: {
      OBJECT: "OBJECT",
      STRING: "STRING",
      ARRAY: "ARRAY",
    },
  };
});

describe("Tailor Advice API", () => {
  beforeEach(() => {
    generateContentMock.mockReset();
  });

  function createRequest(body: unknown) {
    return new Request("http://localhost/api/tailor-advice", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  it("rejects missing fields", async () => {
    const res = await POST(createRequest({}));
    expect(res.status).toBe(400);
  });

  it("rejects non-TAILOR verdicts (APPLY)", async () => {
    const res = await POST(
      createRequest({
        adText: "Job text",
        verdict: { status: "APPLY", reason: "All good" },
      })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Tailor advice is only available for TAILOR verdicts.",
    });
  });

  it("rejects non-TAILOR verdicts (SKIP)", async () => {
    const res = await POST(
      createRequest({
        adText: "Job text",
        verdict: { status: "SKIP", reason: "Not eligible" },
      })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Tailor advice is only available for TAILOR verdicts.",
    });
  });

  it("returns structured advice for TAILOR verdicts", async () => {
    const mockAdvice = {
      summary:
        "This looks like a good fit, but you need to check visa conditions.",
      checks: ["Check your visa status"],
      applicationTips: ["Highlight your skills"],
      recruiterQuestions: ["Ask about working hours"],
    };

    generateContentMock.mockResolvedValue({
      text: JSON.stringify(mockAdvice),
    });

    const res = await POST(
      createRequest({
        adText: "Job text",
        verdict: { status: "TAILOR", reason: "Requires checking" },
        visaProfile: { subclass: "500", duringStudyTerm: true },
        fitProfile: {
          targetField: "Software",
          preferredLocation: "Sydney",
          yearsExperience: 2,
        },
      })
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.advice).toEqual(mockAdvice);

    // Verify Gemini was called
    expect(generateContentMock).toHaveBeenCalledOnce();
    const callArgs = generateContentMock.mock.calls[0][0];
    expect(callArgs.contents).toContain("DETERMINISTIC VERDICT REASON");
    expect(callArgs.contents).toContain("Requires checking");
  });

  it("handles AI extraction failures gracefully", async () => {
    generateContentMock.mockRejectedValue(new Error("API Error"));

    const res = await POST(
      createRequest({
        adText: "Job text",
        verdict: { status: "TAILOR", reason: "Requires checking" },
      })
    );

    // It should return 500 when AI fails
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Failed to generate tailor advice.",
    });
  });

  it("handles empty AI responses gracefully", async () => {
    generateContentMock.mockResolvedValue({
      text: "",
    });

    const res = await POST(
      createRequest({
        adText: "Job text",
        verdict: { status: "TAILOR", reason: "Requires checking" },
      })
    );

    // It should return 500 when AI fails
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Failed to generate tailor advice.",
    });
  });
  it("handles malformed JSON gracefully", async () => {
    generateContentMock.mockResolvedValue({
      text: "{ malformed: json, [ ",
    });

    const res = await POST(
      createRequest({
        adText: "Job text",
        verdict: { status: "TAILOR", reason: "Requires checking" },
      })
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Failed to generate tailor advice.",
    });
  });

  it("instructs the model not to introduce unsupported details", async () => {
    generateContentMock.mockResolvedValue({
      text: JSON.stringify({
        summary: "mock",
        checks: [],
        applicationTips: [],
        recruiterQuestions: [],
      }),
    });

    await POST(
      createRequest({
        adText: "Applicants must be legally entitled to work in Australia.",
        verdict: { status: "TAILOR", reason: "Requires checking" },
      })
    );

    const callArgs = generateContentMock.mock.calls[0][0];
    const prompt = callArgs.contents;

    expect(prompt).toContain("Never infer full-time or part-time status");
    expect(prompt).toContain("occupation / role field");
    expect(prompt).toContain("working hours");
    expect(prompt).toContain("location");
    expect(prompt).toContain(
      "Do not tell the user to put their visa subclass on their CV"
    );
    expect(prompt).toContain(
      "MUST be directly supported by the supplied job ad"
    );
  });
});
