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
  sponsorship?: EvidenceField;
  employmentType?: EvidenceField;
  hoursPerWeek?: EvidenceField;
  registration?: EvidenceField;
  yearsExperience?: EvidenceField;
  location?: EvidenceField;
};
