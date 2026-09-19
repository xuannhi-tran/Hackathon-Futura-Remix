import { ExtractedJobAd } from "../types/job";

type DemoFixture = {
  adText: string;
  extraction: ExtractedJobAd;
};

function evidence(adText: string, text: string, value: string) {
  const start = adText.indexOf(text);

  return {
    value,
    text,
    start,
    end: start + text.length,
  };
}

// -----------------------
// APPLY fixture
// -----------------------

const applyAd =
  "Junior software engineer role open to international graduates. JavaScript and React experience preferred.";

const applyFixture: DemoFixture = {
  adText: applyAd,

  extraction: {
    employmentType: undefined,
    location: undefined,
  },
};

// -----------------------
// TAILOR fixture
// -----------------------

const tailorAd =
  "Previous Australian work experience is required for this role.";

const tailorFixture: DemoFixture = {
  adText: tailorAd,

  extraction: {
    australianExperienceRequirement: evidence(
      tailorAd,
      "Australian work experience",
      "Australian experience required"
    ),
  },
};

// -----------------------
// SKIP fixture
// -----------------------

const skipAd =
  "Applicants must be Australian citizens to be eligible for this role.";

const skipFixture: DemoFixture = {
  adText: skipAd,

  extraction: {
    citizenshipRequirement: evidence(
      skipAd,
      "Australian citizens",
      "Australian citizenship required"
    ),
  },
};

// -----------------------
// VISA / HOURS fixture
// -----------------------

const hoursAd = "This position requires 38 hours per week.";

const hoursFixture: DemoFixture = {
  adText: hoursAd,

  extraction: {
    hoursPerWeek: evidence(hoursAd, "38 hours per week", "38 hours per week"),
  },
};

// -----------------------
// FULL WORK RIGHTS fixture
// -----------------------

const workRightsAd = "Applicants must have full Australian working rights.";

const workRightsFixture: DemoFixture = {
  adText: workRightsAd,

  extraction: {
    workRightsRequirement: evidence(
      workRightsAd,
      "full Australian working rights",
      "Full working rights required"
    ),
  },
};

export const demoFixtures: DemoFixture[] = [
  applyFixture,
  tailorFixture,
  skipFixture,
  hoursFixture,
  workRightsFixture,
];

export function getDemoFixture(adText: string): ExtractedJobAd | undefined {
  const normalisedInput = adText.trim();

  const fixture = demoFixtures.find(
    (item) => item.adText.trim() === normalisedInput
  );

  return fixture?.extraction;
}
