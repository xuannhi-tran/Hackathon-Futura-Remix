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

  // Quan rules integration
  temporaryVisaAllowed?: EvidenceField;
  visaPlanRequirement?: EvidenceField;

  yearsExperience?: EvidenceField;
  location?: EvidenceField;
  roleField?: EvidenceField;
};

export type VisaProfile = {
  subclass: "500" | "485";
  duringStudyTerm: boolean;
  monthsRemaining?: number;
};

export type FitProfile = {
  targetField: string;
  preferredLocation: string;
  yearsExperience: number;
};

export type FitSignal = {
  id: string;
  status: "MATCH" | "STRETCH" | "INFO";
  label: string;
  reason: string;
  evidence?: {
    text: string;
    start: number;
    end: number;
  };
};

export type Verdict = {
  status: "APPLY" | "TAILOR" | "SKIP";
  ruleId?: string;
  reason: string;
  evidence?: {
    text: string;
    start: number;
    end: number;
  };
};

export type SavedJob = {
  id: string;
  title: string;
  adText: string;
  verdict: Verdict;
};

export type TailorAdvice = {
  summary: string;
  checks: string[];
  applicationTips: string[];
  recruiterQuestions: string[];
};
