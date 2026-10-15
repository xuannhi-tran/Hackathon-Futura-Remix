import { describe, expect, it } from "vitest";

import {
  EMPTY_PROFILE_DRAFT,
  PROFILE_REQUIRED_HINT,
  REQUIRED_PROFILE_FIELDS,
  confirmedProfile,
  draftFromSavedProfile,
  missingRequiredProfileFields,
  setFieldsOf,
  withVisaSubclass,
  type ProfileDraft,
} from "../profileRequirements";
import {
  PROFILE_KEY,
  loadProfile,
  saveProfile,
  type StorageLike,
} from "../localState";
import { buildProfileSummary } from "../profileSummary";

function memoryStorage(initial: Record<string, string> = {}): StorageLike {
  const data = new Map(Object.entries(initial));

  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const COMPLETE_500: ProfileDraft = {
  visaSubclass: "500",
  duringStudyTerm: true,
  monthsRemaining: 12,
  yearsExperience: 0,
  preferredLocation: "NSW",
};

describe("first visit (no saved profile)", () => {
  it("leaves every required field unset", () => {
    const draft = draftFromSavedProfile(loadProfile(memoryStorage()));

    expect(draft).toEqual({
      visaSubclass: null,
      duringStudyTerm: null,
      monthsRemaining: null,
      yearsExperience: null,
      preferredLocation: null,
    });
  });

  it("is gated: visa, experience and state are missing (study term and months follow the visa)", () => {
    expect(missingRequiredProfileFields(EMPTY_PROFILE_DRAFT)).toEqual([
      "visaSubclass",
      "yearsExperience",
      "preferredLocation",
    ]);
    expect(confirmedProfile(EMPTY_PROFILE_DRAFT)).toBeNull();
  });

  it("has the hint text for the gate", () => {
    expect(PROFILE_REQUIRED_HINT).toBe(
      "Set your visa and experience first so the result fits you."
    );
  });

  it("lists the required fields in display order", () => {
    expect([...REQUIRED_PROFILE_FIELDS]).toEqual([
      "visaSubclass",
      "duringStudyTerm",
      "monthsRemaining",
      "yearsExperience",
      "preferredLocation",
    ]);
  });
});

describe("saved valid profile", () => {
  const stored = {
    visaSubclass: "500",
    duringStudyTerm: false,
    monthsRemaining: 9,
    targetField: "Data",
    preferredLocation: "VIC",
    yearsExperience: 2,
  };

  it("restores every value and is not gated", () => {
    const draft = draftFromSavedProfile(
      loadProfile(memoryStorage({ [PROFILE_KEY]: JSON.stringify(stored) }))
    );

    expect(draft).toEqual({
      visaSubclass: "500",
      duringStudyTerm: false,
      monthsRemaining: 9,
      yearsExperience: 2,
      preferredLocation: "VIC",
    });
    expect(missingRequiredProfileFields(draft)).toEqual([]);
    expect(confirmedProfile(draft)).toEqual({
      visaSubclass: "500",
      duringStudyTerm: false,
      monthsRemaining: 9,
      yearsExperience: 2,
      preferredLocation: "VIC",
    });
  });

  it("treats a deliberate 'Anywhere in Australia' (empty state) as set", () => {
    const draft = draftFromSavedProfile(
      loadProfile(
        memoryStorage({
          [PROFILE_KEY]: JSON.stringify({ ...stored, preferredLocation: "" }),
        })
      )
    );

    expect(draft.preferredLocation).toBe("");
    expect(missingRequiredProfileFields(draft)).toEqual([]);
  });

  it("treats zero years as set, not as missing", () => {
    expect(
      missingRequiredProfileFields({ ...COMPLETE_500, yearsExperience: 0 })
    ).toEqual([]);
  });
});

describe("old-version or partially missing saved profile", () => {
  it("only the missing required fields are unset", () => {
    const draft = draftFromSavedProfile(
      loadProfile(
        memoryStorage({
          [PROFILE_KEY]: JSON.stringify({
            visaSubclass: "500",
            duringStudyTerm: true,
            targetField: "Software Engineering",
            // no yearsExperience, no preferredLocation
          }),
        })
      )
    );

    expect(draft.visaSubclass).toBe("500");
    expect(draft.duringStudyTerm).toBe(true);
    expect(missingRequiredProfileFields(draft)).toEqual([
      "monthsRemaining",
      "yearsExperience",
      "preferredLocation",
    ]);
  });

  it("an older saved profile that has a months value counts it as set", () => {
    const draft = draftFromSavedProfile(
      loadProfile(
        memoryStorage({
          [PROFILE_KEY]: JSON.stringify({
            visaSubclass: "500",
            duringStudyTerm: true,
            monthsRemaining: 18,
            targetField: "Software Engineering",
            preferredLocation: "NSW",
            yearsExperience: 0,
          }),
        })
      )
    );

    expect(draft.monthsRemaining).toBe(18);
    expect(missingRequiredProfileFields(draft)).toEqual([]);
  });

  it("an invalid stored value counts as missing, the others are kept", () => {
    const draft = draftFromSavedProfile(
      loadProfile(
        memoryStorage({
          [PROFILE_KEY]: JSON.stringify({
            visaSubclass: "999",
            duringStudyTerm: true,
            yearsExperience: -4,
            preferredLocation: "NSW",
          }),
        })
      )
    );

    expect(missingRequiredProfileFields(draft)).toEqual([
      "visaSubclass",
      "yearsExperience",
    ]);
    expect(draft.preferredLocation).toBe("NSW");
  });

  it("only the target field saved (what the app writes before anything is set) keeps all required fields unset", () => {
    const draft = draftFromSavedProfile(
      loadProfile(
        memoryStorage({
          [PROFILE_KEY]: JSON.stringify({ targetField: "Software Engineering" }),
        })
      )
    );

    expect(missingRequiredProfileFields(draft)).toEqual([
      "visaSubclass",
      "yearsExperience",
      "preferredLocation",
    ]);
  });
});

describe("setting the required fields enables the analysis", () => {
  it("500 also requires the study-term answer", () => {
    const draft: ProfileDraft = { ...COMPLETE_500, duringStudyTerm: null };

    expect(missingRequiredProfileFields(draft)).toEqual(["duringStudyTerm"]);
    expect(confirmedProfile(draft)).toBeNull();

    expect(confirmedProfile({ ...draft, duringStudyTerm: false })).not.toBeNull();
  });

  it("485 does not require a study-term answer or months, and the confirmed profile is never in study term", () => {
    const draft: ProfileDraft = {
      visaSubclass: "485",
      duringStudyTerm: null,
      monthsRemaining: null,
      yearsExperience: 1,
      preferredLocation: "QLD",
    };

    expect(missingRequiredProfileFields(draft)).toEqual([]);
    expect(confirmedProfile(draft)?.duringStudyTerm).toBe(false);
    expect(confirmedProfile(draft)?.monthsRemaining).toBeUndefined();
    // Months are optional for 485 and used if the user gave them.
    expect(
      confirmedProfile({ ...draft, monthsRemaining: 20 })?.monthsRemaining
    ).toBe(20);
    // Even a stale "true" left over from 500 cannot leak into a 485 result.
    expect(
      confirmedProfile({ ...draft, duringStudyTerm: true })?.duringStudyTerm
    ).toBe(false);
  });

  it("500 requires months remaining, and says so after the study-term answer", () => {
    const draft: ProfileDraft = { ...COMPLETE_500, monthsRemaining: null };

    expect(missingRequiredProfileFields(draft)).toEqual(["monthsRemaining"]);
    expect(confirmedProfile(draft)).toBeNull();
    expect(
      missingRequiredProfileFields({ ...draft, duringStudyTerm: null })
    ).toEqual(["duringStudyTerm", "monthsRemaining"]);
  });

  it("0 months is a real answer, a negative or non-numeric one is not", () => {
    expect(
      missingRequiredProfileFields({ ...COMPLETE_500, monthsRemaining: 0 })
    ).toEqual([]);
    expect(
      missingRequiredProfileFields({ ...COMPLETE_500, monthsRemaining: -1 })
    ).toEqual(["monthsRemaining"]);
    expect(
      missingRequiredProfileFields({ ...COMPLETE_500, monthsRemaining: NaN })
    ).toEqual(["monthsRemaining"]);
  });

  it("each required field on its own blocks the analysis", () => {
    for (const field of [
      "visaSubclass",
      "monthsRemaining",
      "yearsExperience",
      "preferredLocation",
    ] as const) {
      expect(confirmedProfile({ ...COMPLETE_500, [field]: null })).toBeNull();
    }
    expect(confirmedProfile({ ...COMPLETE_500, yearsExperience: NaN })).toBeNull();
    expect(confirmedProfile({ ...COMPLETE_500, yearsExperience: -1 })).toBeNull();
  });

  it("a fully set profile is confirmed", () => {
    expect(confirmedProfile(COMPLETE_500)).toEqual(COMPLETE_500);
  });
});

describe("persistence of a partly set profile", () => {
  it("writes only the fields that are set, never a default for an unset one", () => {
    const storage = memoryStorage();

    saveProfile(
      {
        ...setFieldsOf({ ...EMPTY_PROFILE_DRAFT, visaSubclass: "500" }),
        targetField: "Software Engineering",
      },
      storage
    );

    const written = JSON.parse(storage.getItem(PROFILE_KEY)!);
    expect(written).toEqual({
      visaSubclass: "500",
      targetField: "Software Engineering",
    });
    expect(written).not.toHaveProperty("monthsRemaining");
    expect(written).not.toHaveProperty("yearsExperience");
    expect(written).not.toHaveProperty("preferredLocation");
  });

  it("round-trips a complete profile unchanged", () => {
    const storage = memoryStorage();

    saveProfile({ ...setFieldsOf(COMPLETE_500), targetField: "Data" }, storage);

    expect(draftFromSavedProfile(loadProfile(storage))).toEqual(COMPLETE_500);
  });
});

describe("the Assuming line never receives an unset value", () => {
  it("is built from the confirmed profile, which exists only when nothing is unset", () => {
    expect(confirmedProfile(EMPTY_PROFILE_DRAFT)).toBeNull();

    const confirmed = confirmedProfile(COMPLETE_500)!;
    const text = buildProfileSummary(confirmed);

    expect(text).toBe(
      "Assuming: Student visa (500), in study term, 12 months left, 0 yrs experience, NSW."
    );
    expect(text).not.toMatch(/null|undefined|NaN|not set/);
  });

  it("describes a deliberate 'Anywhere' choice as any location", () => {
    expect(
      buildProfileSummary(confirmedProfile({ ...COMPLETE_500, preferredLocation: "" })!)
    ).toBe(
      "Assuming: Student visa (500), in study term, 12 months left, 0 yrs experience, any location."
    );
  });

  it("includes months for 500 only, with the singular for one month", () => {
    expect(
      buildProfileSummary(confirmedProfile({ ...COMPLETE_500, monthsRemaining: 1, duringStudyTerm: false })!)
    ).toBe(
      "Assuming: Student visa (500), outside study term, 1 month left, 0 yrs experience, NSW."
    );
    expect(
      buildProfileSummary(
        confirmedProfile({
          ...COMPLETE_500,
          visaSubclass: "485",
          duringStudyTerm: null,
          monthsRemaining: 20,
        })!
      )
    ).toBe("Assuming: Graduate visa (485), 0 yrs experience, NSW.");
  });
});

describe("switching visa subclass leaves no stale values", () => {
  it("500 to 485 clears study term (to no) and months", () => {
    const next = withVisaSubclass(COMPLETE_500, "485");

    expect(next).toMatchObject({
      visaSubclass: "485",
      duringStudyTerm: false,
      monthsRemaining: null,
    });
    expect(next.yearsExperience).toBe(0);
    expect(next.preferredLocation).toBe("NSW");
    expect(missingRequiredProfileFields(next)).toEqual([]);
  });

  it("back to 500 asks for study term and months again", () => {
    const back = withVisaSubclass(withVisaSubclass(COMPLETE_500, "485"), "500");

    expect(back).toMatchObject({
      visaSubclass: "500",
      duringStudyTerm: null,
      monthsRemaining: null,
    });
    expect(missingRequiredProfileFields(back)).toEqual([
      "duringStudyTerm",
      "monthsRemaining",
    ]);
  });

  it("months typed for 485 do not carry back to 500", () => {
    const on485 = { ...withVisaSubclass(COMPLETE_500, "485"), monthsRemaining: 24 };

    expect(withVisaSubclass(on485, "500").monthsRemaining).toBeNull();
  });

  it("choosing the same subclass changes nothing, and choosing 500 first keeps other answers", () => {
    expect(withVisaSubclass(COMPLETE_500, "500")).toBe(COMPLETE_500);
    expect(
      withVisaSubclass({ ...EMPTY_PROFILE_DRAFT, duringStudyTerm: true, monthsRemaining: 6 }, "500")
    ).toMatchObject({ visaSubclass: "500", duringStudyTerm: true, monthsRemaining: 6 });
  });
});
