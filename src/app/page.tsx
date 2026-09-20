"use client";

import { useRef, useState } from "react";

import { mockExtractJobAd } from "../lib/mockExtraction";
import { getDemoFixture } from "../lib/demoFixtures";
import { extractTitle } from "../lib/titleExtraction";

import { evaluateJob, evaluateFitSignals } from "../lib/rules";
import { findClauseStart, findClauseEnd } from "../lib/extractionFallbacks";
import { getDisplayEvidenceSpan } from "../lib/evidenceDisplay";

import {
  ExtractedJobAd,
  SavedJob,
  Verdict,
  FitSignal,
  TailorAdvice,
} from "../types/job";

import type { JobRecommendation } from "../lib/jobRecommendation";

type SuggestedJob = {
  recommendation: JobRecommendation;
  id: string;
  title: string;
  company: string;
  location: string;
  description: string;
  redirectUrl: string;
  created?: string;
  salaryMin?: number;
  salaryMax?: number;
  contractType?: string;
  contractTime?: string;
  category?: string;
};

type SuggestedJobsResponse = {
  query: {
    what: string;
    where: string | null;
  };
  count: number;
  jobs: SuggestedJob[];
  error?: string;
};

const signalStyles = {
  positive: {
    icon: "✓",
    label: "Match",
    className: "text-green-800",
    iconClassName: "bg-green-100 text-green-700",
  },
  neutral: {
    icon: "–",
    label: "Not specified",
    className: "text-gray-500",
    iconClassName: "bg-gray-100 text-gray-500",
  },
  caution: {
    icon: "!",
    label: "Mismatch",
    className: "text-amber-800",
    iconClassName: "bg-amber-100 text-amber-700",
  },
};

// Present the existing eligibility-fit signals without changing their outcomes.
function FitSummary({
  signals,
  targetField,
  preferredLocation,
  yearsExperience,
}: {
  signals: FitSignal[];
  targetField: string;
  preferredLocation: string;
  yearsExperience: number;
}) {
  const rows = [
    {
      label: "Location",
      prefix: "T3_LOCATION_",
      preference: preferredLocation
        ? `You prefer ${preferredLocation}`
        : "No location preference set",
      match: "Matches your preference",
      different: "Different from your preference",
    },
    {
      label: "Field",
      prefix: "T3_FIELD_",
      preference: targetField
        ? `You target ${targetField}`
        : "No target field set",
      match: "Matches your target field",
      different: "Not a clear match for your target field",
    },
    {
      label: "Experience",
      prefix: "T3_EXPERIENCE_",
      preference: `You have ${yearsExperience} years experience`,
      match: "Meets the stated experience",
      different: "More experience requested",
    },
  ];

  return (
    <ul className="divide-y divide-gray-100">
      {rows.map((row) => {
        const signal = signals.find((item) => item.id.startsWith(row.prefix));
        const tone = !signal
          ? "neutral"
          : signal.status === "MATCH"
          ? "positive"
          : "caution";
        const style = signalStyles[tone];

        // Status label for non-colour indicator
        const statusLabel = !signal
          ? "Not specified"
          : signal.status === "MATCH"
          ? row.match
          : row.different;

        return (
          <li
            key={row.label}
            className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
          >
            {/* Icon is decorative; status is conveyed in text below */}
            <span
              aria-hidden="true"
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${style.iconClassName}`}
            >
              {style.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="text-sm font-semibold text-gray-800">
                  {row.label}
                </span>
                <span
                  className={`text-xs font-medium ${style.className}`}
                  aria-label={`${row.label}: ${statusLabel}`}
                >
                  {statusLabel}
                </span>
              </div>
              {signal?.evidence && (
                <p
                  className="mt-0.5 truncate text-xs text-gray-500 leading-5"
                  title={`${signal.evidence.text} · ${row.preference}`}
                >
                  {signal.evidence.text} &middot; {row.preference}
                </p>
              )}
              {!signal && (
                <p className="mt-0.5 text-xs text-gray-400 leading-5">
                  {row.preference}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function Home() {
  const [adText, setAdText] = useState("");
  const [editingProfile, setEditingProfile] = useState(true);
  const [saveMessage, setSaveMessage] = useState("");

  const [verdict, setVerdict] = useState<Verdict | null>(null);

  const [fitSignals, setFitSignals] = useState<FitSignal[]>([]);

  const [isLoading, setIsLoading] = useState(false);

  const [savedJobs, setSavedJobs] = useState<SavedJob[]>([]);

  // -----------------------
  // USER VISA PROFILE
  // -----------------------

  const [visaSubclass, setVisaSubclass] = useState<"500" | "485">("500");

  const [duringStudyTerm, setDuringStudyTerm] = useState(true);

  const [monthsRemaining, setMonthsRemaining] = useState(18);

  // -----------------------
  // CAREER PROFILE
  // -----------------------

  const [targetField, setTargetField] = useState("Software Engineering");

  const [preferredLocation, setPreferredLocation] = useState("NSW");

  const [yearsExperience, setYearsExperience] = useState(0);

  // -----------------------
  // JOB SUGGESTIONS
  // -----------------------

  const [suggestedJobs, setSuggestedJobs] = useState<SuggestedJob[]>([]);

  const [suggestedJobCount, setSuggestedJobCount] = useState(0);

  const [isJobSearchLoading, setIsJobSearchLoading] = useState(false);

  const [jobSearchError, setJobSearchError] = useState<string | null>(null);

  const [hasSearchedJobs, setHasSearchedJobs] = useState(false);

  const [tailorAdvice, setTailorAdvice] = useState<TailorAdvice | null>(null);
  const [isTailorAdviceLoading, setIsTailorAdviceLoading] = useState(false);
  const [tailorAdviceError, setTailorAdviceError] = useState(false);

  function resetAnalysis() {
    setSaveMessage("");
    setVerdict(null);
    setFitSignals([]);
    setTailorAdvice(null);
    setTailorAdviceError(false);
    setIsTailorAdviceLoading(false);
  }

  const jobSearchVersion = useRef(0);

  function resetJobSuggestions() {
    jobSearchVersion.current += 1;
    setIsJobSearchLoading(false);
    setSuggestedJobs([]);
    setSuggestedJobCount(0);
    setJobSearchError(null);
    setHasSearchedJobs(false);
  }

  function formatSalary(job: SuggestedJob) {
    const formatter = new Intl.NumberFormat("en-AU", {
      style: "currency",
      currency: "AUD",
      maximumFractionDigits: 0,
    });

    if (job.salaryMin !== undefined && job.salaryMax !== undefined) {
      return `${formatter.format(job.salaryMin)} – ${formatter.format(
        job.salaryMax
      )}`;
    }

    if (job.salaryMin !== undefined) {
      return `From ${formatter.format(job.salaryMin)}`;
    }

    if (job.salaryMax !== undefined) {
      return `Up to ${formatter.format(job.salaryMax)}`;
    }

    return null;
  }

  function getDescriptionPreview(description: string) {
    const cleaned = description.replace(/\s+/g, " ").trim();

    if (cleaned.length <= 260) {
      return cleaned;
    }

    return `${cleaned.slice(0, 257)}...`;
  }

  async function handleFindJobs() {
    if (!targetField.trim()) {
      return;
    }

    const requestVersion = ++jobSearchVersion.current;
    setSuggestedJobs([]);
    setIsJobSearchLoading(true);
    setJobSearchError(null);
    setHasSearchedJobs(true);

    try {
      const params = new URLSearchParams({
        targetField: targetField.trim(),
        preferredLocation: preferredLocation.trim(),
        subclass: visaSubclass,
        duringStudyTerm: String(duringStudyTerm),
        monthsRemaining: String(monthsRemaining),
        yearsExperience: String(yearsExperience),
      });

      const response = await fetch(`/api/jobs/suggest?${params.toString()}`);

      const data = (await response.json()) as SuggestedJobsResponse;
      if (requestVersion !== jobSearchVersion.current) return;

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to retrieve suggested jobs.");
      }

      setSuggestedJobs((data.jobs ?? []).slice(0, 10));
      setSuggestedJobCount(data.count ?? data.jobs?.length ?? 0);
    } catch (error) {
      if (requestVersion !== jobSearchVersion.current) return;
      console.error("Job suggestion request failed:", error);

      setSuggestedJobs([]);
      setSuggestedJobCount(0);
      setJobSearchError(
        error instanceof Error
          ? error.message
          : "Failed to retrieve suggested jobs."
      );
    } finally {
      if (requestVersion === jobSearchVersion.current)
        setIsJobSearchLoading(false);
    }
  }

  // -----------------------
  // ANALYSIS
  // -----------------------

  async function handleAnalyse() {
    if (!adText.trim()) {
      return;
    }

    setIsLoading(true);
    setVerdict(null);
    setFitSignals([]);
    setTailorAdvice(null);
    setTailorAdviceError(false);

    const visaProfile = {
      subclass: visaSubclass,

      duringStudyTerm: visaSubclass === "500" ? duringStudyTerm : false,

      monthsRemaining,
    };

    const fitProfile = {
      targetField,
      preferredLocation,
      yearsExperience,
    };

    function triggerTailorAdvice(result: Verdict) {
      if (result.status !== "TAILOR") return;
      setIsTailorAdviceLoading(true);
      fetch("/api/tailor-advice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adText,
          verdict: result,
          visaProfile,
          fitProfile,
        }),
      })
        .then((res) => {
          if (!res.ok) throw new Error("Tailor advice failed");
          return res.json();
        })
        .then((data) => {
          if (data.advice) setTailorAdvice(data.advice);
          else setTailorAdviceError(true);
        })
        .catch((err) => {
          console.error(err);
          setTailorAdviceError(true);
        })
        .finally(() => setIsTailorAdviceLoading(false));
    }

    // -----------------------
    // OFFLINE MODE
    // -----------------------

    if (!navigator.onLine) {
      const fixture = getDemoFixture(adText);

      if (fixture) {
        const result = evaluateJob(fixture, visaProfile);

        const signals = evaluateFitSignals(fixture, fitProfile);

        setVerdict(result);
        setFitSignals(signals);
        triggerTailorAdvice(result);
        setIsLoading(false);

        return;
      }

      const extracted = mockExtractJobAd(adText);

      const result = evaluateJob(extracted, visaProfile);

      const signals = evaluateFitSignals(extracted, fitProfile);

      setVerdict(result);
      setFitSignals(signals);
      triggerTailorAdvice(result);
      setIsLoading(false);

      return;
    }

    // -----------------------
    // ONLINE AI MODE
    // -----------------------

    try {
      const response = await fetch("/api/extract", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          adText,
        }),
      });

      if (!response.ok) {
        throw new Error(`AI extraction failed with status ${response.status}`);
      }

      const data = await response.json();

      const extracted: ExtractedJobAd = data.extraction;

      const result = evaluateJob(extracted, visaProfile);

      const signals = evaluateFitSignals(extracted, fitProfile);

      setVerdict(result);
      setFitSignals(signals);
      triggerTailorAdvice(result);
    } catch (error) {
      console.warn(
        "AI extraction unavailable. Using cached/local fallback.",
        error
      );

      const fixture = getDemoFixture(adText);

      if (fixture) {
        const result = evaluateJob(fixture, visaProfile);

        const signals = evaluateFitSignals(fixture, fitProfile);

        setVerdict(result);
        setFitSignals(signals);
        triggerTailorAdvice(result);

        return;
      }

      const extracted = mockExtractJobAd(adText);

      const result = evaluateJob(extracted, visaProfile);

      const signals = evaluateFitSignals(extracted, fitProfile);

      setVerdict(result);
      setFitSignals(signals);
      triggerTailorAdvice(result);
    } finally {
      setIsLoading(false);
    }
  }

  // -----------------------
  // PORTFOLIO
  // -----------------------

  function addToPortfolio() {
    if (!verdict) return;

    const firstLine = extractTitle(adText) ?? "Untitled job";

    const title =
      firstLine.length > 60 ? `${firstLine.slice(0, 60)}...` : firstLine;

    const job: SavedJob = {
      id: crypto.randomUUID(),
      title,
      adText,
      verdict,
    };

    setSavedJobs((current) => [...current, job]);
    setSaveMessage("Saved to your portfolio for this session.");
  }

  function removeFromPortfolio(id: string) {
    setSavedJobs((current) => current.filter((job) => job.id !== id));
  }

  // -----------------------
  // PORTFOLIO METRICS
  // -----------------------

  const applyCount = savedJobs.filter(
    (job) => job.verdict.status === "APPLY"
  ).length;

  const tailorCount = savedJobs.filter(
    (job) => job.verdict.status === "TAILOR"
  ).length;

  const skipCount = savedJobs.filter(
    (job) => job.verdict.status === "SKIP"
  ).length;

  const totalJobs = savedJobs.length;

  const effortLeak =
    totalJobs === 0 ? 0 : Math.round((skipCount / totalJobs) * 100);

  const rankedJobs = [...savedJobs].sort((a, b) => {
    const rank = {
      APPLY: 0,
      TAILOR: 1,
      SKIP: 2,
    };

    return rank[a.verdict.status] - rank[b.verdict.status];
  });

  function getRecommendation() {
    if (applyCount > 0)
      return "Start with your APPLY roles, then review the conditions on your TAILOR roles.";
    if (tailorCount > 0)
      return "Review the conditions on your TAILOR roles and decide which ones you can address.";
    return "Your saved roles have requirements that may conflict with your profile. Explore suggested jobs to find other options.";
  }

  // -----------------------
  // EVIDENCE HIGHLIGHT
  // -----------------------

  function renderEvidenceExcerpt() {
    if (!verdict?.evidence) {
      return <p>No specific evidence was identified in the supplied job ad.</p>;
    }

    const displaySpan = getDisplayEvidenceSpan(adText, verdict);
    if (!displaySpan) {
      return (
        <p>
          The evidence could not be located reliably in the supplied job ad.
        </p>
      );
    }

    const { displayStart, displayEnd } = displaySpan;

    // Keep the original offsets and exact source characters; bound only the context.
    const contextStart = Math.max(0, displayStart - 240);
    const contextEnd = Math.min(adText.length, displayEnd + 240);

    // Plain yellow text-marker highlight via inline style (immune to CSS resets).
    return (
      <>
        {contextStart > 0 && "..."}
        {adText.slice(contextStart, displayStart)}

        <mark
          id="ad-evidence"
          tabIndex={-1}
          className="px-0.5 scroll-mt-6"
          style={{ backgroundColor: "#fde68a", color: "inherit" }}
        >
          {adText.slice(displayStart, displayEnd)}
        </mark>

        {adText.slice(displayEnd, contextEnd)}
        {contextEnd < adText.length && "..."}
      </>
    );
  }

  // Verdict colour helpers — soft semantic, not saturated
  const verdictColours = {
    APPLY: {
      badge: "bg-green-100 text-green-800 border border-green-200",
      card: "border-green-200 bg-green-50/60",
      accentBar: "bg-green-500",
      heading: "text-green-800",
      headingLabel: "APPLY",
      labelBg: "bg-green-100 text-green-800 border border-green-200",
      evidenceBorder: "border-gray-200",
    },
    TAILOR: {
      badge: "bg-amber-100 text-amber-800 border border-amber-200",
      card: "border-amber-200 bg-amber-50/60",
      accentBar: "bg-amber-400",
      heading: "text-amber-800",
      headingLabel: "TAILOR",
      labelBg: "bg-amber-100 text-amber-800 border border-amber-200",
      evidenceBorder: "border-gray-200",
    },
    SKIP: {
      badge: "bg-red-100 text-red-800 border border-red-200",
      card: "border-red-200 bg-red-50/60",
      accentBar: "bg-red-400",
      heading: "text-red-800",
      headingLabel: "SKIP",
      labelBg: "bg-red-100 text-red-800 border border-red-200",
      evidenceBorder: "border-gray-200",
    },
  } as const;

  const vc = verdict ? verdictColours[verdict.status] : null;

  // Verdict description text
  const verdictDescription =
    verdict?.status === "APPLY"
      ? "This role does not show any obvious eligibility blockers for your current profile."
      : verdict?.status === "TAILOR"
      ? "This role may still be worth applying for, but a condition needs your attention."
      : "This role contains a requirement that appears to conflict with your current profile.";

  const verdictNextStep =
    verdict?.status === "APPLY"
      ? "Review the full application requirements before applying."
      : verdict?.status === "TAILOR"
      ? "Check the condition above and whether you can meet it before applying or starting work."
      : "Consider similar roles without this restriction, and verify the requirement with the employer if unclear.";

  return (
    <main className="min-h-screen bg-[#f8fafc] text-gray-900">
      {/* ── Header ── */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto w-full max-w-[1440px] px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h1 className="text-xl font-bold tracking-tight text-gray-900">
              JobCompass
            </h1>
            <p className="text-sm text-gray-500">
              Find better-fit roles. Decide where to apply.
            </p>
          </div>
          <p className="mt-1.5 text-xs text-gray-400">
            Decision support only — not migration advice. Always verify your
            visa conditions and the employer&apos;s requirements.
          </p>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8 space-y-6">
        {/* ── Profile card ── */}
        <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-4 px-5 py-4 sm:px-6">
            <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
              Your profile
            </h2>
            <button
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors"
              aria-expanded={editingProfile}
              aria-controls="profile-editor"
              onClick={() => setEditingProfile(!editingProfile)}
            >
              {editingProfile ? "Done editing" : "Edit profile"}
            </button>
          </div>

          {!editingProfile && (
            <div className="border-t border-gray-100 px-5 py-3 sm:px-6">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
                <span>
                  {visaSubclass === "500"
                    ? "Student visa 500"
                    : "Graduate visa 485"}
                </span>
                <span aria-hidden="true" className="text-gray-300">
                  |
                </span>
                <span>
                  {visaSubclass === "500"
                    ? duringStudyTerm
                      ? "Studying now"
                      : "Outside study term"
                    : "Study term not applicable"}
                </span>
                <span aria-hidden="true" className="text-gray-300">
                  |
                </span>
                <span>{monthsRemaining} months remaining</span>
                <span aria-hidden="true" className="text-gray-300">
                  |
                </span>
                <span>{targetField || "Field not set"}</span>
                <span aria-hidden="true" className="text-gray-300">
                  |
                </span>
                <span>{preferredLocation || "Anywhere in Australia"}</span>
                <span aria-hidden="true" className="text-gray-300">
                  |
                </span>
                <span>{yearsExperience} yrs experience</span>
              </div>
            </div>
          )}

          <fieldset
            id="profile-editor"
            hidden={!editingProfile}
            disabled={isLoading}
            className="border-t border-gray-100 px-5 py-5 sm:px-6 min-w-0"
          >
            <legend className="sr-only">Edit your profile</legend>
            {/* Two equal columns side-by-side on desktop, stacked on mobile */}
            <div className="flex flex-col gap-6 md:flex-row md:gap-0">
              {/* VISA column */}
              <div className="flex-1 md:pr-6">
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
                  Visa details
                </p>
                <div className="flex flex-col gap-4">
                  <div>
                    <label
                      htmlFor="visaSubclass"
                      className="mb-1 block text-sm font-medium text-gray-700"
                    >
                      Visa subclass
                    </label>
                    <select
                      id="visaSubclass"
                      value={visaSubclass}
                      onChange={(e) => {
                        const value = e.target.value as "500" | "485";

                        setVisaSubclass(value);

                        if (value === "485") {
                          setDuringStudyTerm(false);
                        }

                        resetAnalysis();
                        resetJobSuggestions();
                      }}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    >
                      <option value="500">Student visa (500)</option>
                      <option value="485">Graduate visa (485)</option>
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="duringStudyTerm"
                      className="mb-1 block text-sm font-medium text-gray-700"
                    >
                      Currently studying?
                    </label>
                    <select
                      id="duringStudyTerm"
                      value={duringStudyTerm ? "yes" : "no"}
                      onChange={(e) => {
                        setDuringStudyTerm(e.target.value === "yes");
                        resetAnalysis();
                        resetJobSuggestions();
                      }}
                      disabled={visaSubclass !== "500"}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400"
                    >
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="monthsRemaining"
                      className="mb-1 block text-sm font-medium text-gray-700"
                    >
                      Months remaining on visa
                    </label>
                    <input
                      type="number"
                      min="0"
                      id="monthsRemaining"
                      value={monthsRemaining}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        setMonthsRemaining(Number.isNaN(value) ? 0 : value);
                        resetAnalysis();
                        resetJobSuggestions();
                      }}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                  </div>
                </div>
              </div>

              {/* Vertical divider — desktop only */}
              <div className="hidden md:block md:w-px md:self-stretch md:bg-gray-100" />

              {/* CAREER column */}
              <div className="flex-1 md:pl-6">
                <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
                  Career goals
                </p>
                <div className="flex flex-col gap-4">
                  <div>
                    <label
                      htmlFor="targetField"
                      className="mb-1 block text-sm font-medium text-gray-700"
                    >
                      Target field
                    </label>
                    <input
                      type="text"
                      id="targetField"
                      value={targetField}
                      onChange={(e) => {
                        setTargetField(e.target.value);
                        resetAnalysis();
                        resetJobSuggestions();
                      }}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="preferredLocation"
                      className="mb-1 block text-sm font-medium text-gray-700"
                    >
                      Preferred state/territory
                    </label>
                    <select
                      id="preferredLocation"
                      value={preferredLocation}
                      onChange={(e) => {
                        setPreferredLocation(e.target.value);
                        resetAnalysis();
                        resetJobSuggestions();
                      }}
                      disabled={isLoading || isJobSearchLoading}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-gray-50 disabled:text-gray-500"
                    >
                      <option value="">Anywhere in Australia</option>
                      <option value="NSW">NSW — New South Wales</option>
                      <option value="VIC">VIC — Victoria</option>
                      <option value="QLD">QLD — Queensland</option>
                      <option value="WA">WA — Western Australia</option>
                      <option value="SA">SA — South Australia</option>
                      <option value="TAS">TAS — Tasmania</option>
                      <option value="ACT">
                        ACT — Australian Capital Territory
                      </option>
                      <option value="NT">NT — Northern Territory</option>
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="yearsExperience"
                      className="mb-1 block text-sm font-medium text-gray-700"
                    >
                      Years of experience
                    </label>
                    <input
                      type="number"
                      min="0"
                      id="yearsExperience"
                      value={yearsExperience}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        setYearsExperience(Number.isNaN(value) ? 0 : value);
                        resetAnalysis();
                        resetJobSuggestions();
                      }}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                  </div>
                </div>
              </div>
            </div>
          </fieldset>
        </section>

        {/* ── Check a job ── */}
        <div id="section-check" tabIndex={-1} className="scroll-mt-6">
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="text-lg font-bold text-gray-900">
              Is this job worth applying for?
            </h2>
            <p className="mt-1 text-sm text-gray-500 leading-relaxed">
              Paste a full job advertisement to check for requirements that may
              affect you.
            </p>
            <label
              htmlFor="job-ad"
              className="mb-1.5 mt-5 block text-sm font-medium text-gray-700"
            >
              Job advertisement
            </label>
            <textarea
              id="job-ad"
              value={adText}
              disabled={isLoading}
              onChange={(e) => {
                setAdText(e.target.value);
                resetAnalysis();
              }}
              placeholder="Paste the full job advertisement here…"
              className="min-h-48 w-full max-w-4xl rounded-lg border border-gray-300 bg-white p-4 text-sm leading-7 text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 disabled:bg-gray-50 disabled:text-gray-400"
            />
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {/* Primary CTA */}
              <button
                onClick={handleAnalyse}
                disabled={!adText.trim() || isLoading}
                className="inline-flex min-h-10 items-center justify-center rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading ? "Checking…" : "Analyse job"}
              </button>
              <span role="status" className="text-sm text-gray-500">
                {isLoading ? "Checking the job ad against your profile…" : ""}
              </span>
            </div>
          </section>

          {/* ── Result ── */}
          {verdict && vc && (
            <section aria-label="Your result" className="mt-4 space-y-4">
              {/* Verdict + Evidence two-column grid */}
              <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)]">
                {/* Verdict card */}
                <div
                  className={`min-w-0 overflow-hidden rounded-xl border ${vc.card} shadow-sm`}
                >
                  {/* Coloured accent bar at top */}
                  <div
                    className={`h-1 w-full ${vc.accentBar}`}
                    aria-hidden="true"
                  />

                  <div className="p-5 sm:p-6">
                    {/* Verdict label + badge */}
                    <div className="flex items-center gap-3">
                      <span
                        className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold tracking-wide uppercase ${vc.labelBg}`}
                        aria-label={`Verdict: ${verdict.status}`}
                      >
                        {verdict.status}
                      </span>
                    </div>

                    {/* Summary sentence */}
                    <p className="mt-3 text-base font-semibold leading-snug text-gray-900 max-w-prose">
                      {verdictDescription}
                    </p>

                    {/* Why this result */}
                    <div className="mt-4">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                        Why this result
                      </h3>
                      <p className="mt-1.5 max-w-prose break-words text-sm leading-6 text-gray-700">
                        {verdict.reason}
                      </p>
                    </div>

                    {/* Next step */}
                    <div className="mt-4">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                        Next step
                      </h3>
                      <p className="mt-1.5 max-w-prose text-sm leading-6 text-gray-700">
                        {verdictNextStep}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="mt-5 flex flex-wrap items-center gap-3">
                      {verdict.status === "SKIP" && (
                        <a
                          href="#section-suggested"
                          className="inline-flex min-h-10 items-center justify-center rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors"
                        >
                          Find similar jobs
                        </a>
                      )}
                      {/* Save button — primary when no SKIP link, outline secondary otherwise */}
                      <button
                        onClick={addToPortfolio}
                        disabled={Boolean(saveMessage)}
                        className={`inline-flex min-h-10 items-center justify-center rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors ${
                          saveMessage
                            ? "border-green-200 bg-green-50 text-green-800 cursor-default"
                            : verdict.status === "SKIP"
                            ? "border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                            : "border-slate-900 bg-slate-900 text-white hover:bg-slate-700"
                        }`}
                      >
                        {saveMessage ? "Saved ✓" : "Save to portfolio"}
                      </button>
                    </div>
                    {saveMessage && (
                      <p role="status" className="mt-2 text-xs text-gray-500">
                        {saveMessage}
                      </p>
                    )}
                  </div>
                </div>

                {/* Evidence card */}
                <aside
                  aria-labelledby="evidence-heading"
                  className="min-w-0 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6 lg:sticky lg:top-6"
                >
                  <h3
                    id="evidence-heading"
                    className="text-sm font-semibold text-gray-700"
                  >
                    Evidence from the job ad
                  </h3>
                  <p className="mt-0.5 text-xs text-gray-400">
                    The highlighted clause drove this result.
                  </p>
                  <div
                    className="mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-4 text-sm leading-7 text-gray-700 [overflow-wrap:anywhere] border border-gray-100"
                    tabIndex={0}
                    role="region"
                    aria-label="Job ad evidence excerpt"
                  >
                    {renderEvidenceExcerpt()}
                  </div>
                </aside>
              </div>

              {/* Fit with your goals */}
              {verdict.status === "SKIP" ? (
                <details className="group rounded-xl border border-gray-200 bg-white shadow-sm">
                  <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-4 text-sm font-semibold text-gray-700 sm:px-6">
                    <span>Fit with your goals</span>
                    <span
                      aria-hidden="true"
                      className="text-gray-400 transition-transform group-open:rotate-180 select-none"
                    >
                      ▾
                    </span>
                  </summary>
                  <div className="border-t border-gray-100 px-5 py-4 sm:px-6">
                    <FitSummary
                      signals={fitSignals}
                      targetField={targetField}
                      preferredLocation={preferredLocation}
                      yearsExperience={yearsExperience}
                    />
                  </div>
                </details>
              ) : (
                <details
                  className="group rounded-xl border border-gray-200 bg-white shadow-sm"
                  open
                >
                  <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-4 text-sm font-semibold text-gray-700 sm:px-6">
                    <span>Fit with your goals</span>
                    <span
                      aria-hidden="true"
                      className="text-gray-400 transition-transform group-open:rotate-180 select-none"
                    >
                      ▾
                    </span>
                  </summary>
                  <div className="border-t border-gray-100 px-5 py-4 sm:px-6">
                    <FitSummary
                      signals={fitSignals}
                      targetField={targetField}
                      preferredLocation={preferredLocation}
                      yearsExperience={yearsExperience}
                    />
                  </div>
                </details>
              )}

              {/* Tailor advice */}
              {verdict.status === "TAILOR" && (
                <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
                  <div className="border-b border-gray-100 px-5 py-4 sm:px-6">
                    <h3 className="text-base font-bold text-gray-900">
                      How to approach this role
                    </h3>
                    <p className="mt-0.5 text-xs text-gray-400">
                      AI-generated guidance based on the highlighted
                      requirement.
                    </p>
                  </div>

                  <div className="px-5 py-5 sm:px-6">
                    {isTailorAdviceLoading ? (
                      <p className="text-sm text-gray-500">
                        Generating tailored advice…
                      </p>
                    ) : tailorAdviceError || !tailorAdvice ? (
                      <p className="text-sm font-medium text-amber-700">
                        AI guidance is unavailable right now. Review the
                        highlighted requirement before applying.
                      </p>
                    ) : (
                      <div className="space-y-6 text-sm">
                        {/* Summary */}
                        <p className="text-sm font-medium leading-relaxed text-gray-800 max-w-prose">
                          {tailorAdvice.summary}
                        </p>

                        {tailorAdvice.checks &&
                          tailorAdvice.checks.length > 0 && (
                            <div>
                              <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">
                                What to check
                              </p>
                              <ul className="space-y-2">
                                {tailorAdvice.checks.map((c, i) => (
                                  <li
                                    key={i}
                                    className="flex items-start gap-2.5 text-sm text-gray-700 leading-relaxed"
                                  >
                                    <span
                                      aria-hidden="true"
                                      className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 text-xs font-bold"
                                    >
                                      ✓
                                    </span>
                                    {c}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                        {tailorAdvice.applicationTips &&
                          tailorAdvice.applicationTips.length > 0 && (
                            <div>
                              <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">
                                Application tips
                              </p>
                              <ul className="space-y-2">
                                {tailorAdvice.applicationTips.map((c, i) => (
                                  <li
                                    key={i}
                                    className="flex items-start gap-2.5 text-sm text-gray-700 leading-relaxed"
                                  >
                                    <span
                                      aria-hidden="true"
                                      className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 text-xs font-bold"
                                    >
                                      →
                                    </span>
                                    {c}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                        {tailorAdvice.recruiterQuestions &&
                          tailorAdvice.recruiterQuestions.length > 0 && (
                            <div>
                              <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">
                                Questions you could ask
                              </p>
                              <ul className="space-y-2">
                                {tailorAdvice.recruiterQuestions.map((c, i) => (
                                  <li
                                    key={i}
                                    className="flex items-start gap-2.5 text-sm text-gray-600 leading-relaxed"
                                  >
                                    <span
                                      aria-hidden="true"
                                      className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 text-xs font-bold"
                                    >
                                      ?
                                    </span>
                                    {c}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                      </div>
                    )}
                  </div>
                </section>
              )}
            </section>
          )}
        </div>

        {/* ── Suggested jobs ── */}
        <div id="section-suggested" tabIndex={-1} className="scroll-mt-6">
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                  Next applications
                </p>
                <h2 className="mt-1 text-lg font-bold text-gray-900">
                  Suggested jobs
                </h2>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-500">
                  Find current opportunities that may suit your profile.
                </p>
              </div>

              {/* Primary CTA */}
              <button
                onClick={handleFindJobs}
                disabled={!targetField.trim() || isJobSearchLoading}
                className="shrink-0 inline-flex items-center justify-center rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
              >
                {isJobSearchLoading ? "Finding jobs…" : "Find matching jobs"}
              </button>
            </div>

            <p className="mt-3 max-w-prose text-xs text-gray-400">
              Profile matches are estimates from Adzuna summaries, not
              eligibility decisions.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-gray-600">
              <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1">
                Field: {targetField || "Not set"}
              </span>

              <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1">
                State: {preferredLocation || "Anywhere in Australia"}
              </span>
            </div>

            <p role="status" className="mt-3 text-sm text-gray-500">
              {isJobSearchLoading ? "Finding roles for your profile…" : ""}
            </p>

            {jobSearchError && (
              <div className="mt-5 rounded-lg border border-red-100 bg-red-50 p-4">
                <p className="text-sm font-semibold text-red-800">
                  Could not load suggested jobs
                </p>
                <p className="mt-0.5 text-sm text-red-600">{jobSearchError}</p>
              </div>
            )}

            {hasSearchedJobs &&
              !isJobSearchLoading &&
              !jobSearchError &&
              suggestedJobs.length === 0 && (
                <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-5">
                  <p className="text-sm text-gray-600">
                    No matching jobs were returned for this field and location.
                    Try a broader target field or nearby location.
                  </p>
                </div>
              )}

            {suggestedJobs.length > 0 && (
              <>
                <div className="mt-6 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
                  <p className="text-sm font-semibold text-gray-800">
                    {suggestedJobs.length} suggested role
                    {suggestedJobs.length === 1 ? "" : "s"}
                  </p>

                  <p className="text-xs text-gray-400">
                    {suggestedJobCount > 0
                      ? `${suggestedJobCount.toLocaleString()} total Adzuna results`
                      : "Current Adzuna results"}
                  </p>
                </div>

                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  {suggestedJobs.map((job) => {
                    const salary = formatSalary(job);

                    return (
                      <article
                        key={job.id}
                        className="flex h-full min-w-0 break-words flex-col rounded-xl border border-gray-200 bg-white p-5 transition-shadow hover:shadow-sm hover:border-gray-300"
                      >
                        <div className="flex-1">
                          <h3 className="text-base font-semibold leading-snug text-gray-900">
                            {job.title}
                          </h3>

                          <p className="mt-1 text-sm font-medium text-gray-600">
                            {job.company}
                          </p>

                          <p className="mt-0.5 text-sm text-gray-400">
                            {job.location}
                          </p>

                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            {job.category && (
                              <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                                {job.category}
                              </span>
                            )}

                            {job.contractTime && (
                              <span className="rounded-full border border-gray-200 px-2.5 py-0.5 text-xs text-gray-500">
                                {job.contractTime.replaceAll("_", " ")}
                              </span>
                            )}

                            {job.contractType && (
                              <span className="rounded-full border border-gray-200 px-2.5 py-0.5 text-xs text-gray-500">
                                {job.contractType.replaceAll("_", " ")}
                              </span>
                            )}
                          </div>

                          {!job.contractTime && !job.contractType && (
                            <p className="mt-1.5 text-xs text-gray-400">
                              Contract information not listed
                            </p>
                          )}

                          {salary && (
                            <p className="mt-2 text-sm font-semibold text-gray-800">
                              {salary}
                            </p>
                          )}

                          <div className="mt-3 border-t border-gray-100 pt-3">
                            <p className="text-xs text-gray-500">
                              <span className="font-semibold text-gray-700">
                                Profile match
                              </span>{" "}
                              <span>{job.recommendation.score}%</span>
                            </p>
                            <ul
                              className="mt-2 space-y-1.5"
                              aria-label="Profile match signals"
                            >
                              {job.recommendation.signals
                                .slice(0, 4)
                                .map((signal) => {
                                  const style = signalStyles[signal.tone];
                                  return (
                                    <li
                                      key={signal.id}
                                      className={`flex items-start gap-2 text-xs leading-5 ${style.className}`}
                                    >
                                      <span
                                        aria-hidden="true"
                                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-xs font-bold ${style.iconClassName}`}
                                      >
                                        {style.icon}
                                      </span>
                                      <span>
                                        <span className="sr-only">
                                          {style.label}:{" "}
                                        </span>
                                        {signal.text}
                                      </span>
                                    </li>
                                  );
                                })}
                            </ul>
                          </div>

                          {job.description && (
                            <p className="mt-3 max-w-prose text-sm leading-6 text-gray-500">
                              {getDescriptionPreview(job.description)}
                            </p>
                          )}
                        </div>

                        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
                          <span className="text-xs text-gray-400">
                            Jobs by Adzuna
                          </span>

                          {/* Secondary CTA — outline */}
                          <a
                            href={job.redirectUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                          >
                            View job ↗
                          </a>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        </div>

        {/* ── Application Portfolio ── */}
        <div id="section-portfolio" tabIndex={-1} className="scroll-mt-6">
          {savedJobs.length === 0 ? (
            <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
              <h2 className="text-lg font-bold text-gray-900">
                Application Portfolio
              </h2>
              <p className="mt-2 text-sm text-gray-500 leading-relaxed">
                Save jobs after analysing them to compare where your application
                effort is going.
              </p>
              {/* Secondary CTA — outline */}
              <a
                href="#section-check"
                className="mt-4 inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Check a job
              </a>
            </section>
          ) : (
            <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="mb-5 flex items-baseline justify-between gap-4">
                <h2 className="text-lg font-bold text-gray-900">
                  Application Portfolio
                </h2>
                <span className="text-sm text-gray-400">
                  {totalJobs} job{totalJobs === 1 ? "" : "s"} saved
                </span>
              </div>

              {/* Summary counts */}
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Total
                  </p>
                  <p className="mt-1 text-3xl font-bold text-gray-900">
                    {totalJobs}
                  </p>
                </div>

                <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-green-600">
                    Apply
                  </p>
                  <p className="mt-1 text-3xl font-bold text-green-800">
                    {applyCount}
                  </p>
                </div>

                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">
                    Tailor
                  </p>
                  <p className="mt-1 text-3xl font-bold text-amber-800">
                    {tailorCount}
                  </p>
                </div>

                <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-red-600">
                    Skip
                  </p>
                  <p className="mt-1 text-3xl font-bold text-red-800">
                    {skipCount}
                  </p>
                </div>
              </div>

              {/* Applications at risk */}
              <div
                className={`mt-4 rounded-lg border p-4 ${
                  effortLeak === 0
                    ? "border-green-200 bg-green-50"
                    : effortLeak < 50
                    ? "border-amber-200 bg-amber-50"
                    : "border-red-200 bg-red-50"
                }`}
              >
                <p
                  className={`text-xs font-semibold uppercase tracking-wide ${
                    effortLeak === 0
                      ? "text-green-600"
                      : effortLeak < 50
                      ? "text-amber-600"
                      : "text-red-600"
                  }`}
                >
                  Applications at risk
                </p>
                <p
                  className={`mt-1 text-3xl font-bold ${
                    effortLeak === 0
                      ? "text-green-800"
                      : effortLeak < 50
                      ? "text-amber-800"
                      : "text-red-800"
                  }`}
                >
                  {skipCount} of {totalJobs}
                </p>
                <p
                  className={`mt-0.5 text-sm font-medium ${
                    effortLeak === 0
                      ? "text-green-700"
                      : effortLeak < 50
                      ? "text-amber-700"
                      : "text-red-700"
                  }`}
                >
                  {effortLeak}% at risk &middot; Lower is better
                </p>
                <p className="mt-1.5 text-xs text-gray-500">
                  Saved roles in this group contain requirements that may
                  conflict with your current profile.
                </p>
              </div>

              {/* Recommendation */}
              <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                  Where to focus next
                </p>
                <p className="mt-1.5 max-w-prose text-sm leading-6 text-blue-900">
                  {getRecommendation()}
                </p>
              </div>

              {/* Ranked jobs */}
              <div className="mt-6">
                <div className="mb-3 flex items-baseline justify-between">
                  <h3 className="text-sm font-semibold text-gray-700">
                    Priority order
                  </h3>
                  <p className="text-xs text-gray-400">Apply → Tailor → Skip</p>
                </div>

                <div className="space-y-2">
                  {rankedJobs.map((job) => (
                    <div
                      key={job.id}
                      className="flex flex-col items-start justify-between gap-3 sm:flex-row rounded-lg border border-gray-100 bg-white p-4 hover:bg-gray-50 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-gray-900">
                          {job.title}
                        </p>
                        <p className="mt-0.5 text-xs text-gray-500 leading-5">
                          {job.verdict.reason}
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <span
                          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${
                            job.verdict.status === "APPLY"
                              ? "bg-green-50 border-green-200 text-green-800"
                              : job.verdict.status === "TAILOR"
                              ? "bg-amber-50 border-amber-200 text-amber-800"
                              : "bg-red-50 border-red-200 text-red-800"
                          }`}
                        >
                          {job.verdict.status}
                        </span>

                        {/* Secondary action */}
                        <button
                          onClick={() => removeFromPortfolio(job.id)}
                          className="rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
                          aria-label="Remove job from portfolio"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}
          <p className="mt-3 text-xs text-gray-400">
            Your portfolio is kept for this session only. Refreshing the page
            clears saved jobs.
          </p>
        </div>
      </div>
    </main>
  );
}
