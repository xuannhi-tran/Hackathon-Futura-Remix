/**
 * Saved jobs and profile persistence in localStorage.
 * Storage is injected, so no browser is needed.
 */

import { describe, expect, it } from "vitest";

import {
  MAX_SAVED_JOBS,
  PROFILE_KEY,
  SAVED_JOBS_KEY,
  clearSavedJobs,
  loadProfile,
  loadSavedJobs,
  saveProfile,
  saveSavedJobs,
  type StorageLike,
} from "../localState";

import type { SavedJob } from "../../types/job";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: StorageLike & { data: Map<string, string> } = {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
  return storage;
}

function throwingStorage(): StorageLike {
  const fail = () => {
    throw new Error("SecurityError");
  };
  return { getItem: fail, setItem: fail, removeItem: fail };
}

function job(n: number, overrides: Partial<SavedJob> = {}): SavedJob {
  return {
    id: `job-${n}`,
    title: `Graduate Engineer ${n}`,
    adText: `Ad text number ${n}`,
    verdict: {
      status: "TAILOR",
      ruleId: "T2_WORK_RIGHTS_REVIEW",
      reason: "Review the requirement.",
      evidence: { text: "Ad", start: 0, end: 2 },
    },
    ...overrides,
  };
}

describe("saved jobs", () => {
  it("round-trips through storage under a versioned key", () => {
    const storage = memoryStorage();
    const jobs = [job(1), job(2, { verdict: { status: "APPLY", reason: "ok" } })];

    saveSavedJobs(jobs, storage);

    expect(SAVED_JOBS_KEY).toBe("jobcompass:saved:v1");
    expect(storage.data.has(SAVED_JOBS_KEY)).toBe(true);
    expect(loadSavedJobs(storage)).toEqual(jobs);
  });

  it("returns an empty list when nothing is stored", () => {
    expect(loadSavedJobs(memoryStorage())).toEqual([]);
  });

  it("survives malformed JSON and wrong top-level shapes", () => {
    for (const raw of ["{not json", "null", '"text"', "42", '{"jobs":[]}']) {
      expect(loadSavedJobs(memoryStorage({ [SAVED_JOBS_KEY]: raw }))).toEqual([]);
    }
  });

  it("drops malformed entries but keeps valid ones", () => {
    const good = job(1);
    const raw = JSON.stringify([
      good,
      null,
      "string",
      { id: "x" },
      { ...job(2), verdict: { status: "MAYBE", reason: "r" } },
      { ...job(3), verdict: { status: "SKIP" } },
      { ...job(4), adText: 42 },
      { ...job(5), verdict: { status: "SKIP", reason: "r", evidence: { text: "a", start: 5, end: 1 } } },
      { ...job(6), id: "" },
      good,
    ]);

    expect(loadSavedJobs(memoryStorage({ [SAVED_JOBS_KEY]: raw }))).toEqual([
      good,
    ]);
  });

  it("caps the list at 50, keeping the most recent, on save and on load", () => {
    const many = Array.from({ length: 60 }, (_, i) => job(i));
    const storage = memoryStorage();

    saveSavedJobs(many, storage);
    const saved = JSON.parse(storage.data.get(SAVED_JOBS_KEY)!);
    expect(MAX_SAVED_JOBS).toBe(50);
    expect(saved).toHaveLength(50);
    expect(saved[0].id).toBe("job-10");
    expect(saved[49].id).toBe("job-59");

    const oversized = memoryStorage({ [SAVED_JOBS_KEY]: JSON.stringify(many) });
    const loaded = loadSavedJobs(oversized);
    expect(loaded).toHaveLength(50);
    expect(loaded[49].id).toBe("job-59");
  });

  it("never throws when storage throws, or is unavailable", () => {
    for (const storage of [throwingStorage(), null]) {
      expect(() => saveSavedJobs([job(1)], storage)).not.toThrow();
      expect(loadSavedJobs(storage)).toEqual([]);
      expect(() => clearSavedJobs(storage)).not.toThrow();
    }
  });

  it("clearSavedJobs removes the stored list", () => {
    const storage = memoryStorage();
    saveSavedJobs([job(1)], storage);

    clearSavedJobs(storage);

    expect(storage.data.has(SAVED_JOBS_KEY)).toBe(false);
    expect(loadSavedJobs(storage)).toEqual([]);
  });
});

describe("profile", () => {
  const profile = {
    visaSubclass: "485" as const,
    duringStudyTerm: false,
    monthsRemaining: 24,
    targetField: "Data Analytics",
    preferredLocation: "VIC",
    yearsExperience: 2,
  };

  it("round-trips under a versioned key", () => {
    const storage = memoryStorage();

    saveProfile(profile, storage);

    expect(PROFILE_KEY).toBe("jobcompass:profile:v1");
    expect(loadProfile(storage)).toEqual(profile);
  });

  it("returns null for missing, malformed or non-object data", () => {
    expect(loadProfile(memoryStorage())).toBeNull();
    for (const raw of ["{bad", "null", "[]", "7"]) {
      expect(loadProfile(memoryStorage({ [PROFILE_KEY]: raw }))).toBeNull();
    }
  });

  it("keeps valid fields and drops invalid ones individually", () => {
    const raw = JSON.stringify({
      visaSubclass: "999",
      duringStudyTerm: "yes",
      monthsRemaining: -4,
      targetField: "Cyber Security",
      preferredLocation: 12,
      yearsExperience: 3,
      unexpected: "ignored",
    });

    expect(loadProfile(memoryStorage({ [PROFILE_KEY]: raw }))).toEqual({
      targetField: "Cyber Security",
      yearsExperience: 3,
    });
  });

  it("rejects out-of-range numbers and over-long strings", () => {
    const raw = JSON.stringify({
      monthsRemaining: 100000,
      yearsExperience: 500,
      targetField: "x".repeat(500),
      preferredLocation: "y".repeat(500),
    });

    expect(loadProfile(memoryStorage({ [PROFILE_KEY]: raw }))).toEqual({});
  });

  it("never throws when storage throws or is unavailable", () => {
    for (const storage of [throwingStorage(), null]) {
      expect(() => saveProfile(profile, storage)).not.toThrow();
      expect(loadProfile(storage)).toBeNull();
    }
  });
});
