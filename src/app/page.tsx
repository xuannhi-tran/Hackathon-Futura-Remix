"use client";

import { useRef, useState } from "react";

import { mockExtractJobAd } from "../lib/mockExtraction";
import { getDemoFixture } from "../lib/demoFixtures";

import { evaluateJob, evaluateFitSignals } from "../lib/rules";

import { ExtractedJobAd, SavedJob, Verdict, FitSignal } from "../types/job";

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
  positive: { icon: "\u2713", label: "Match", className: "text-green-800", iconClassName: "bg-green-50 text-green-700" },
  neutral: { icon: "i", label: "Information", className: "text-gray-600", iconClassName: "bg-gray-100 text-gray-600" },
  caution: { icon: "!", label: "Caution", className: "text-amber-800", iconClassName: "bg-amber-50 text-amber-700" },
};

// Present the existing eligibility-fit signals without changing their outcomes.
function FitSummary({ signals, targetField, preferredLocation, yearsExperience }: {
  signals: FitSignal[];
  targetField: string;
  preferredLocation: string;
  yearsExperience: number;
}) {
  const rows = [
    { label: "Location", prefix: "T3_LOCATION_", preference: preferredLocation ? `You prefer ${preferredLocation}` : "No location preference set", match: "Matches your preference", different: "Different from your preference" },
    { label: "Field", prefix: "T3_FIELD_", preference: targetField ? `You target ${targetField}` : "No target field set", match: "Matches your target field", different: "Not a clear match for your target field" },
    { label: "Experience", prefix: "T3_EXPERIENCE_", preference: `You have ${yearsExperience} years experience`, match: "Meets the stated experience", different: "More experience requested" },
  ];
  return <ul className="divide-y divide-gray-100">
    {rows.map((row) => {
      const signal = signals.find((item) => item.id.startsWith(row.prefix));
      const tone = !signal ? "neutral" : signal.status === "MATCH" ? "positive" : "caution";
      const style = signalStyles[tone];
      return <li key={row.label} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
        <span aria-hidden="true" className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${style.iconClassName}`}>{style.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
            <span className="font-medium">{row.label}</span>
            <span className={style.className}>{!signal ? "Not specified" : signal.status === "MATCH" ? row.match : row.different}</span>
          </div>
          {signal?.evidence && <p className="mt-1 truncate text-xs text-gray-600" title={`${signal.evidence.text} - ${row.preference}`}>
            {signal.evidence.text} &middot; {row.preference}
          </p>}
        </div>
      </li>;
    })}
  </ul>;
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

  const [preferredLocation, setPreferredLocation] = useState("Sydney");

  const [yearsExperience, setYearsExperience] = useState(0);

  // -----------------------
  // JOB SUGGESTIONS
  // -----------------------

  const [suggestedJobs, setSuggestedJobs] = useState<SuggestedJob[]>([]);

  const [suggestedJobCount, setSuggestedJobCount] = useState(0);

  const [isJobSearchLoading, setIsJobSearchLoading] = useState(false);

  const [jobSearchError, setJobSearchError] = useState<string | null>(null);

  const [hasSearchedJobs, setHasSearchedJobs] = useState(false);

  function resetAnalysis() {
    setSaveMessage("");
    setVerdict(null);
    setFitSignals([]);
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
      if (requestVersion === jobSearchVersion.current) setIsJobSearchLoading(false);
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
        setIsLoading(false);

        return;
      }

      const extracted = mockExtractJobAd(adText);

      const result = evaluateJob(extracted, visaProfile);

      const signals = evaluateFitSignals(extracted, fitProfile);

      setVerdict(result);
      setFitSignals(signals);
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

        return;
      }

      const extracted = mockExtractJobAd(adText);

      const result = evaluateJob(extracted, visaProfile);

      const signals = evaluateFitSignals(extracted, fitProfile);

      setVerdict(result);
      setFitSignals(signals);
    } finally {
      setIsLoading(false);
    }
  }

  // -----------------------
  // PORTFOLIO
  // -----------------------

  function addToPortfolio() {
    if (!verdict) return;

    const firstLine =
      adText
        .split("\n")
        .find((line) => line.trim().length > 0)
        ?.trim() ?? "Untitled job";

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
    if (applyCount > 0) return "Start with your APPLY roles, then review the conditions on your TAILOR roles.";
    if (tailorCount > 0) return "Review the conditions on your TAILOR roles and decide which ones you can address.";
    return "Your saved roles have requirements that may conflict with your profile. Explore suggested jobs to find other options.";
  }

  // -----------------------
  // EVIDENCE HIGHLIGHT
  // -----------------------

  function renderEvidenceExcerpt() {
    if (!verdict?.evidence) {
      return <p>No specific evidence was identified in the supplied job ad.</p>;
    }

    const { start, end } = verdict.evidence;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > adText.length) {
      return <p>The evidence could not be located reliably in the supplied job ad.</p>;
    }
    // Keep the original offsets and exact source characters; bound only the context.
    const contextStart = Math.max(0, start - 240);
    const contextEnd = Math.min(adText.length, end + 240);

    // Semantic highlight colour based on verdict status
    const markClass =
      verdict.status === "APPLY"
        ? "rounded px-0.5 bg-green-100 text-green-900 font-medium"
        : verdict.status === "TAILOR"
        ? "rounded px-0.5 bg-amber-100 text-amber-900 font-medium"
        : "rounded px-0.5 bg-red-100 text-red-900 font-medium";

    return (
      <>
        {contextStart > 0 && "..."}
        {adText.slice(contextStart, start)}

        <mark id="ad-evidence" tabIndex={-1} className={`${markClass} scroll-mt-6`}>{adText.slice(start, end)}</mark>

        {adText.slice(end, contextEnd)}
        {contextEnd < adText.length && "..."}
      </>
    );
  }

  // Verdict colour helpers
  const verdictColours = {
    APPLY: {
      badge: "bg-green-100 text-green-800 border border-green-200",
      card: "border-green-200 bg-green-50",
      heading: "text-green-800",
      evidence: "bg-green-50 border border-green-200",
      evidenceLabel: "text-green-700",
      evidenceText: "text-green-900",
    },
    TAILOR: {
      badge: "bg-amber-100 text-amber-800 border border-amber-200",
      card: "border-amber-200 bg-amber-50",
      heading: "text-amber-800",
      evidence: "bg-amber-50 border border-amber-200",
      evidenceLabel: "text-amber-700",
      evidenceText: "text-amber-900",
    },
    SKIP: {
      badge: "bg-red-100 text-red-800 border border-red-200",
      card: "border-red-200 bg-red-50",
      heading: "text-red-800",
      evidence: "bg-red-50 border border-red-200",
      evidenceLabel: "text-red-700",
      evidenceText: "text-red-900",
    },
  } as const;

  const vc = verdict ? verdictColours[verdict.status] : null;

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
          <h1 className="text-2xl font-bold tracking-tight">Job Eligibility Decoder</h1>
          <p className="mt-1 text-gray-600">Understand the requirements. Find your next opportunity.</p>
          <p className="mt-2 text-xs text-gray-600">Decision support only, not migration advice. Always check the employer&apos;s requirements and your visa conditions.</p>
        </div>
      </header>
      <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
        <section className="mb-6 rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="font-semibold">Your profile</h2>
            <button className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium hover:bg-gray-50"
              aria-expanded={editingProfile} aria-controls="profile-editor" onClick={() => setEditingProfile(!editingProfile)}>
              {editingProfile ? "Use this profile" : "Edit profile"}
            </button>
          </div>
          {!editingProfile && <div className="mt-3 space-y-1 text-sm text-gray-600">
            <p>{visaSubclass === "500" ? "Student visa 500" : "Graduate visa 485"} &middot; {visaSubclass === "500" ? duringStudyTerm ? "Studying now" : "Outside study term" : "Study term not applicable"} &middot; {monthsRemaining} months remaining</p>
            <p>{targetField || "Field not set"} &middot; {preferredLocation || "Anywhere in Australia"} &middot; {yearsExperience} years experience</p>
          </div>}
          <fieldset id="profile-editor" hidden={!editingProfile} disabled={isLoading} className="mt-5 min-w-0">
            <legend className="sr-only">Edit your profile</legend>
          {/* Two equal columns side-by-side on desktop, stacked on mobile */}
          <div className="flex flex-col gap-6 md:flex-row md:gap-0">
            {/* VISA column */}
            <div className="flex-1 md:pr-6">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
                Visa
              </p>
              <div className="flex flex-col gap-4">
                <div>
                  <label htmlFor="visaSubclass" className="mb-1 block text-sm font-medium text-gray-700">
                    Visa
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
                    className="w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                  >
                    <option value="500">Student visa (500)</option>
                    <option value="485">Graduate visa (485)</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="duringStudyTerm" className="mb-1 block text-sm font-medium text-gray-700">
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
                    className="w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
                  >
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="monthsRemaining" className="mb-1 block text-sm font-medium text-gray-700">
                    Months remaining on your visa
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
                    className="w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                  />
                </div>
              </div>
            </div>

            {/* Vertical divider — desktop only */}
            <div className="hidden md:block md:w-px md:self-stretch md:bg-gray-100" />

            {/* CAREER column */}
            <div className="flex-1 md:pl-6">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-500">
                Career
              </p>
              <div className="flex flex-col gap-4">
                <div>
                  <label htmlFor="targetField" className="mb-1 block text-sm font-medium text-gray-700">
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
                    className="w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                  />
                </div>

                <div>
                  <label htmlFor="preferredLocation" className="mb-1 block text-sm font-medium text-gray-700">
                    Preferred location
                  </label>
                  <input
                    type="text"
                    id="preferredLocation"
                    value={preferredLocation}
                    onChange={(e) => {
                      setPreferredLocation(e.target.value);
                      resetAnalysis();
                      resetJobSuggestions();
                    }}
                    className="w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                  />
                </div>

                <div>
                  <label htmlFor="yearsExperience" className="mb-1 block text-sm font-medium text-gray-700">
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
                    className="w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
                  />
                </div>
              </div>
            </div>
          </div>

          </fieldset>
        </section>
        <div id="section-check" tabIndex={-1} className="mb-8 scroll-mt-6 rounded-xl">
          <section className="mb-6 rounded-xl border border-gray-200 bg-white p-5 sm:p-6">
            <h2 className="text-xl font-bold">Is this job worth applying for?</h2>
            <p className="mt-2 text-sm text-gray-600">Paste a full job advertisement to check for requirements that may affect you.</p>
            <label htmlFor="job-ad" className="mb-2 mt-5 block text-sm font-medium">Job advertisement</label>
            <textarea id="job-ad" value={adText} disabled={isLoading}
              onChange={(e) => { setAdText(e.target.value); resetAnalysis(); }}
              placeholder="Paste the full job advertisement here..."
              className="min-h-48 w-full max-w-4xl rounded-lg border border-gray-300 p-4 text-sm leading-7 disabled:bg-gray-50" />
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button onClick={handleAnalyse} disabled={!adText.trim() || isLoading}
                className="rounded-lg bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-40">
                {isLoading ? "Checking requirements..." : "Analyse job"}
              </button>
              <span role="status" className="text-sm text-gray-600">{isLoading ? "Checking the job ad against your profile." : ""}</span>
            </div>
          </section>

          {verdict && vc && <section aria-label="Your result" className="mb-6 space-y-4">
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,11fr)_minmax(0,9fr)]">
            <div className={`min-w-0 rounded-xl border p-5 sm:p-6 ${vc.card}`}>
              <h2 className={`text-2xl font-bold ${vc.heading}`}>{verdict.status}</h2>
              <p className="mt-2 max-w-prose text-base font-medium">{verdict.status === "APPLY"
                ? "This role does not show any obvious eligibility blockers for your current profile."
                : verdict.status === "TAILOR" ? "This role may still be worth applying for, but a condition needs your attention."
                : "This role contains a requirement that appears to conflict with your current profile."}</p>
              <h3 className="mt-5 text-sm font-semibold">Why this result</h3>
              <p className="mt-1 max-w-prose break-words text-sm leading-6">{verdict.reason}</p>
              <h3 className="mt-5 text-sm font-semibold">Next step</h3>
              <p className="mt-1 max-w-prose text-sm">{verdict.status === "APPLY" ? "Review the full application requirements before applying."
                : verdict.status === "TAILOR" ? "Check the condition above and whether you can meet it before applying or starting work."
                : "Consider similar roles without this restriction, and verify the requirement with the employer if unclear."}</p>
              <div className="mt-5 flex flex-wrap items-center gap-3">
                {verdict.status === "SKIP" && <a href="#section-suggested" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-900 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700">Find similar jobs</a>}
                <button onClick={addToPortfolio} disabled={Boolean(saveMessage)}
                  className={`inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2.5 text-sm font-semibold ${saveMessage ? "border-green-300 bg-green-50 text-green-800" : verdict.status === "SKIP" ? "border-gray-400 bg-white text-gray-800 hover:bg-gray-50" : "border-slate-900 bg-slate-900 text-white hover:bg-slate-700"}`}>
                  {saveMessage ? "Saved \u2713" : "Save to portfolio"}
                </button>
              </div>
              <p role="status" className="mt-2 text-sm">{saveMessage}</p>
            </div>
            <aside aria-labelledby="evidence-heading" className="min-w-0 rounded-xl border border-gray-200 bg-white p-5 sm:p-6 lg:sticky lg:top-6">
              <h3 id="evidence-heading" className="font-semibold">Evidence from the job ad</h3>
              <div className="mt-3 max-h-96 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-7 text-gray-700 [overflow-wrap:anywhere]" tabIndex={0} role="region" aria-label="Job ad evidence excerpt">
                {renderEvidenceExcerpt()}
              </div>
            </aside>
            </div>
            {verdict.status === "SKIP" ? (
              <details className="rounded-lg border border-gray-200 bg-white p-4">
                <summary className="cursor-pointer text-sm font-medium text-gray-600">See how this role fits your goals</summary>
                <div className="mt-3"><FitSummary signals={fitSignals} targetField={targetField} preferredLocation={preferredLocation} yearsExperience={yearsExperience} /></div>
              </details>
            ) : (
              <section className="rounded-xl border border-gray-200 bg-white p-5">
                <h3 className="mb-3 font-semibold">Fit with your goals</h3>
                <FitSummary signals={fitSignals} targetField={targetField} preferredLocation={preferredLocation} yearsExperience={yearsExperience} />
              </section>
            )}
          </section>}
        </div>

        <div id="section-suggested" tabIndex={-1} className="mb-8 scroll-mt-6 rounded-xl">
        <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">
                Next applications
              </p>
              <h2 className="mt-1 text-xl font-bold text-gray-900">
                Suggested jobs
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-500">
                Find current opportunities that may suit your profile.
              </p>
            </div>

            <button
              onClick={handleFindJobs}
              disabled={!targetField.trim() || isJobSearchLoading}
              className="shrink-0 rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isJobSearchLoading ? "Finding jobs…" : "Find matching jobs"}
            </button>
          </div>

          <p className="mt-3 max-w-prose text-sm text-gray-500">
            Profile matches are estimates from Adzuna summaries, not eligibility decisions.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-gray-600">
            <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1">
              Field: {targetField || "Not set"}
            </span>

            <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1">
              Location: {preferredLocation || "Australia"}
            </span>
          </div>

          <p role="status" className="mt-4 text-sm text-gray-600">
            {isJobSearchLoading ? "Finding roles for your profile..." : ""}
          </p>
          {jobSearchError && (
            <div className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4">
              <p className="text-sm font-medium text-red-800">
                Could not load suggested jobs.
              </p>
              <p className="mt-1 text-sm text-red-700">{jobSearchError}</p>
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

                <p className="text-xs text-gray-600">
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
                      className="flex h-full min-w-0 break-words flex-col rounded-xl border border-gray-200 bg-white p-5 transition hover:border-gray-300 hover:shadow-sm"
                    >
                      <div className="flex-1">
                        <h3 className="mt-3 text-base font-semibold leading-6 text-gray-900">
                          {job.title}
                        </h3>

                        <p className="mt-1 text-sm font-medium text-gray-600">
                          {job.company}
                        </p>

                        <p className="mt-1 text-sm text-gray-500">
                          {job.location}
                        </p>


                        <div className="flex flex-wrap items-center gap-2">
                          {job.category && (
                            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
                              {job.category}
                            </span>
                          )}

                          {job.contractTime && (
                            <span className="rounded-full border border-gray-200 px-2.5 py-1 text-xs text-gray-600">
                              {job.contractTime.replaceAll("_", " ")}
                            </span>
                          )}

                          {job.contractType && (
                            <span className="rounded-full border border-gray-200 px-2.5 py-1 text-xs text-gray-600">
                              {job.contractType.replaceAll("_", " ")}
                            </span>
                          )}
                        </div>

                        {!job.contractTime && !job.contractType && (
                          <p className="mt-2 text-xs text-gray-600">Contract information not listed</p>
                        )}
                        {salary && (
                          <p className="mt-2 text-sm font-semibold text-gray-800">
                            {salary}
                          </p>
                        )}

                        <div className="mt-3 border-t border-gray-100 pt-3">
                          <p className="text-sm text-gray-600">
                            <span className="font-semibold text-gray-900">Profile match</span>{" "}
                            <span className="text-sm text-gray-600">{job.recommendation.score}%</span>
                          </p>
                          <ul className="mt-2 space-y-1.5" aria-label="Profile match signals">
                            {job.recommendation.signals.slice(0, 4).map((signal) => {
                              const style = signalStyles[signal.tone];
                              return (
                                <li key={signal.id} className={`flex items-start gap-2 text-xs leading-5 ${style.className}`}>
                                  <span aria-hidden="true" className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${style.iconClassName}`}>
                                    {style.icon}
                                  </span>
                                  <span><span className="sr-only">{style.label}: </span>{signal.text}</span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>

                        {job.description && (
                          <p className="mt-3 max-w-prose text-sm leading-6 text-gray-600">
                            {getDescriptionPreview(job.description)}
                          </p>
                        )}
                      </div>

                      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
                        <span className="text-xs text-gray-600">
                          Jobs by Adzuna
                        </span>

                        <a
                          href={job.redirectUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                          View job
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
        <div id="section-portfolio" tabIndex={-1} className="mb-8 scroll-mt-6 rounded-xl">
          {savedJobs.length === 0 ? <section className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="text-xl font-bold">Application Portfolio</h2>
            <p className="mt-3 text-sm text-gray-600">Save jobs after analysing them to compare where your application effort is going.</p>
            <a href="#section-check" className="mt-5 inline-block rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white">Check a job</a>
          </section> : (
          <section className="mb-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-6 flex items-baseline justify-between gap-4">
              <h2 className="text-xl font-bold text-gray-900">
                Application Portfolio
              </h2>
              <span className="text-sm text-gray-500">
                {totalJobs} job{totalJobs === 1 ? "" : "s"} saved
              </span>
            </div>

            {/* Summary counts */}
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-gray-200 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Total
                </p>
                <p className="mt-1 text-3xl font-bold text-gray-900">
                  {totalJobs}
                </p>
              </div>

              <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-green-600">
                  Apply
                </p>
                <p className="mt-1 text-3xl font-bold text-green-800">
                  {applyCount}
                </p>
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-amber-600">
                  Tailor
                </p>
                <p className="mt-1 text-3xl font-bold text-amber-800">
                  {tailorCount}
                </p>
              </div>

              <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-red-600">
                  Skip
                </p>
                <p className="mt-1 text-3xl font-bold text-red-800">
                  {skipCount}
                </p>
              </div>
            </div>

            {/* Effort leak */}
            <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                Application effort
              </p>
              <p className="mt-1 text-4xl font-bold text-gray-900">
                {effortLeak}%
              </p>
              <p className="mt-1.5 text-sm text-gray-600">
                {effortLeak}% of your saved roles contain requirements that may conflict with your profile.
              </p>
            </div>

            {/* Recommendation */}
            <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                Where to focus next
              </p>
              <p className="mt-2 max-w-prose text-sm leading-6 text-blue-900">
                {getRecommendation()}
              </p>
            </div>

            {/* Ranked jobs */}
            <div className="mt-6">
              <div className="mb-3 flex items-baseline justify-between">
                <h3 className="text-sm font-semibold text-gray-700">
                  Priority order
                </h3>
                <p className="text-xs text-gray-600">
                  APPLY first, then TAILOR, then SKIP
                </p>
              </div>

              <div className="space-y-2">
                {rankedJobs.map((job) => (
                  <div
                    key={job.id}
                    className="flex flex-col items-start justify-between gap-3 sm:flex-row rounded-lg border border-gray-100 p-4 hover:bg-gray-50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900">
                        {job.title}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-600">
                        {job.verdict.reason}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          job.verdict.status === "APPLY"
                            ? "bg-green-100 text-green-800"
                            : job.verdict.status === "TAILOR"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {job.verdict.status}
                      </span>

                      <button
                        onClick={() => removeFromPortfolio(job.id)}
                        className="rounded px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
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
          <p className="mt-3 text-xs text-gray-600">Your portfolio is kept for this session. Refreshing the page clears saved jobs.</p>
        </div>
      </div>
    </main>
  );
}
