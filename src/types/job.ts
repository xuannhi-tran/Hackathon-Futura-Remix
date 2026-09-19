export type EvidenceField = {
  value: string;
  text: string;
  start: number;
  end: number;
};

export type ExtractedJobAd = {
  citizenshipRequirement?: EvidenceField;
  residencyRequirement?: EvidenceField;
  securityClearance?: EvidenceField;

  workRightsRequirement?: EvidenceField;
  sponsorship?: EvidenceField;
  employmentType?: EvidenceField;
  hoursPerWeek?: EvidenceField;
  australianExperienceRequirement?: EvidenceField;

  registration?: EvidenceField;
  yearsExperience?: EvidenceField;
  location?: EvidenceField;
};

export type VisaProfile = {
  subclass: "500" | "485";
  duringStudyTerm: boolean;
  monthsRemaining?: number;
};
