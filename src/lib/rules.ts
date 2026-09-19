import { ExtractedJobAd } from "../types/job";

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

export function evaluateJob(job: ExtractedJobAd): Verdict {
  if (job.citizenshipRequirement) {
    return {
      status: "SKIP",
      ruleId: "T1_CITIZENSHIP",
      reason: "This role requires Australian citizenship.",
      evidence: {
        text: job.citizenshipRequirement.text,
        start: job.citizenshipRequirement.start,
        end: job.citizenshipRequirement.end,
      },
    };
  }

  if (job.residencyRequirement) {
    return {
      status: "SKIP",
      ruleId: "T1_PERMANENT_RESIDENCY",
      reason: "This role requires Australian permanent residency.",
      evidence: {
        text: job.residencyRequirement.text,
        start: job.residencyRequirement.start,
        end: job.residencyRequirement.end,
      },
    };
  }

  if (job.securityClearance) {
    return {
      status: "SKIP",
      ruleId: "T1_SECURITY_CLEARANCE",
      reason: "This role requires a security clearance.",
      evidence: {
        text: job.securityClearance.text,
        start: job.securityClearance.start,
        end: job.securityClearance.end,
      },
    };
  }

  return {
    status: "APPLY",
    reason: "No hard eligibility blockers detected.",
  };
}
