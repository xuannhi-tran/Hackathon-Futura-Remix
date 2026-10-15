/**
 * Server-render checks (react-dom/server, no browser): the Fit section is open
 * by default for every verdict, and heads-ups are labelled in text.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import FitDetails from "../../app/FitDetails";
import HeadsUpList from "../../app/HeadsUpList";
import type { HeadsUp } from "../headsUp";

describe("FitDetails", () => {
  it("renders the Fit section open by default", () => {
    const html = renderToStaticMarkup(
      <FitDetails>
        <p>content</p>
      </FitDetails>
    );

    expect(html).toMatch(/^<details[^>]*\sopen(=""|\s|>)/);
    expect(html).toContain("Fit with your goals");
    expect(html).toContain("<p>content</p>");
  });

  it("has a 44px-minimum tap target on its summary", () => {
    expect(renderToStaticMarkup(<FitDetails>x</FitDetails>)).toContain("min-h-11");
  });
});

describe("HeadsUpList", () => {
  const items: HeadsUp[] = [
    {
      id: "EXPERIENCE_GAP",
      severity: "warn",
      message: "This ad asks for 5+ years of experience; your profile says 0.",
      evidence: { text: "5+ years", start: 0, end: 8 },
    },
    { id: "SOMETHING", severity: "info", message: "A plain note." },
  ];

  it("renders nothing when there are no heads-ups", () => {
    expect(renderToStaticMarkup(<HeadsUpList headsUps={[]} />)).toBe("");
  });

  it("labels the block and each item in text, not only colour", () => {
    const html = renderToStaticMarkup(<HeadsUpList headsUps={items} />);

    expect(html).toContain("Heads-up");
    expect(html).toContain("Worth checking: ");
    expect(html).toContain("Note: ");
    expect(html).toContain("These do not change the result above.");
    expect(html).toContain("&ldquo;5+ years&rdquo;".replace("&ldquo;", "“").replace("&rdquo;", "”"));
  });
});
