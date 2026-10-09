import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CONTACT_EMAIL } from "../siteConfig";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);

    return statSync(full).isDirectory()
      ? sourceFiles(full)
      : /\.(ts|tsx)$/.test(name)
        ? [full]
        : [];
  });
}

describe("contact address", () => {
  it("is a plausible email address", () => {
    expect(CONTACT_EMAIL).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  });

  it("is defined once: the literal appears only in siteConfig.ts", () => {
    const srcDir = path.join(process.cwd(), "src");
    const offenders = sourceFiles(srcDir)
      .filter((file) => !file.endsWith("siteConfig.ts"))
      .filter((file) => !file.endsWith("siteConfig.test.ts"))
      .filter((file) => readFileSync(file, "utf8").includes(CONTACT_EMAIL))
      .map((file) => path.relative(srcDir, file));

    expect(offenders).toEqual([]);
  });

  it("is never part of the analytics whitelist or events", () => {
    const schema = readFileSync(
      path.join(process.cwd(), "src", "lib", "analyticsSchema.ts"),
      "utf8"
    );

    expect(schema).not.toContain("CONTACT_EMAIL");
    expect(schema).not.toContain(CONTACT_EMAIL);
  });
});
