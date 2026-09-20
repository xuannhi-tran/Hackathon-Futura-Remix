import { describe, expect, it } from "vitest";
import { extractTitle } from "../titleExtraction";

describe("extractTitle", () => {
  it("A. extracts graduate role when preceded by company name", () => {
    const text = "Acme Corp\nGraduate Software Engineer\nWe are looking for...";
    expect(extractTitle(text)).toBe("Graduate Software Engineer");
  });

  it("B. ignores description-only graduate mentions and finds the real title", () => {
    const text = "About us\nWe welcome recent graduate applications.\nSoftware Engineer\nDescription here...";
    expect(extractTitle(text)).toBe("Software Engineer");
  });

  it("C. handles markdown headers", () => {
    const text = "# Graduate Data Analyst\nSome details";
    expect(extractTitle(text)).toBe("Graduate Data Analyst");
  });

  it("falls back to the first line if nothing matches well", () => {
    const text = "Just some really long text that does not have any obvious short titles and is definitely over 60 characters long so it gets skipped by the heuristics.";
    expect(extractTitle(text)).toBe(text);
  });
});
