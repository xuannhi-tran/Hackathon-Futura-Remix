/**
 * Server-render checks (react-dom/server, no browser). Rendering the page on
 * the server is the first-visit state: no localStorage, nothing restored.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import Home from "../../app/page";
import ProfileRequiredHint from "../../app/ProfileRequiredHint";

describe("ProfileRequiredHint", () => {
  it("renders nothing when nothing is missing", () => {
    expect(renderToStaticMarkup(<ProfileRequiredHint missing={[]} onSetUp={() => {}} />)).toBe("");
  });

  it("shows the hint, what is still to set, and a 44px action, in text", () => {
    const html = renderToStaticMarkup(
      <ProfileRequiredHint
        missing={["visaSubclass", "monthsRemaining", "yearsExperience", "preferredLocation"]}
        onSetUp={() => {}}
      />
    );

    expect(html).toContain("Set your visa and experience first so the result fits you.");
    expect(html).toContain(
      "Still to set: Visa subclass, Months remaining on visa, Years of experience, Preferred state/territory."
    );
    expect(html).toContain("Set up your profile");
    expect(html).toContain("min-h-11");
    expect(html).toContain('id="profile-required-hint"');
  });
});

describe("first visit: the page as first rendered", () => {
  const html = renderToStaticMarkup(<Home />);

  it("shows no silent defaults: the required fields start on 'Select…'", () => {
    const field = (id: string) =>
      html.match(new RegExp(`<select[^>]*id="${id}"[^>]*>[\\s\\S]*?</select>`))![0];

    for (const id of ["visaSubclass", "preferredLocation"]) {
      expect(field(id)).toContain("Select…");
      // The placeholder is the only option marked as chosen.
      const chosen = field(id).match(/<option[^>]*selected[^>]*>[^<]*/g)!;
      expect(chosen).toHaveLength(1);
      expect(chosen[0]).toContain("Select…");
    }

    const years = html.match(/<input[^>]*id="yearsExperience"[^>]*>/)![0];
    expect(years).toMatch(/value=""/);
    expect(years).toContain('placeholder="e.g. 0"');
  });

  it("does not render a saved-looking profile summary", () => {
    expect(html).not.toMatch(/Assuming:/);
  });

  it("keeps the ad textarea available", () => {
    expect(html).toMatch(/<textarea[^>]*id="job-ad"/);
    expect(html).not.toMatch(/<textarea[^>]*id="job-ad"[^>]*\sdisabled=/);
  });

  it("marks Analyse as not ready (aria-disabled) while the profile is incomplete", () => {
    const button = html.match(/<button[^>]*>[^<]*(?:<[^>]+>[^<]*)*?Analyse job<\/button>/)![0];

    expect(button).toContain('aria-disabled="true"');
  });

  it("starts months remaining empty with a hint, not 18", () => {
    const months = html.match(/<input[^>]*id="monthsRemaining"[^>]*>/)![0];

    expect(months).toMatch(/value=""/);
    expect(months).toContain('placeholder="e.g. 12"');
    expect(months).not.toContain('value="18"');
  });

  it("keeps the target field default", () => {
    expect(html).toContain('value="Software Engineering"');
  });
});
