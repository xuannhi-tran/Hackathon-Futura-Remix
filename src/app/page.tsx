"use client";

import { useRef, useState } from "react";

import { mockExtractJobAd } from "../lib/mockExtraction";
import { getDemoFixture } from "../lib/demoFixtures";

import { evaluateJob, evaluateFitSignals } from "../lib/rules";

import { ExtractedJobAd, SavedJob, Verdict, FitSignal } from "../types/job";

import type { JobRecommendation } from "../lib/jobRecommendation";

type AnalysisSource = "AI" | "LOCAL";

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

export default function Home() {
  const [adText, setAdText] = useState("");

  const [verdict, setVerdict] = useState<Verdict | null>(null);

  const [fitSignals, setFitSignals] = useState<FitSignal[]>([]);

  const [isLoading, setIsLoading] = useState(false);

  const [analysisSource, setAnalysisSource] = useState<AnalysisSource | null>(
    null
  );

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
    setVerdict(null);
    setFitSignals([]);
    setAnalysisSource(null);
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
    setAnalysisSource(null);

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
        setAnalysisSource("LOCAL");
        setIsLoading(false);

        return;
      }

      const extracted = mockExtractJobAd(adText);

      const result = evaluateJob(extracted, visaProfile);

      const signals = evaluateFitSignals(extracted, fitProfile);

      setVerdict(result);
      setFitSignals(signals);
      setAnalysisSource("LOCAL");
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
      setAnalysisSource("AI");
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
        setAnalysisSource("LOCAL");

        return;
      }

      const extracted = mockExtractJobAd(adText);

      const result = evaluateJob(extracted, visaProfile);

      const signals = evaluateFitSignals(extracted, fitProfile);

      setVerdict(result);
      setFitSignals(signals);
      setAnalysisSource("LOCAL");
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
    if (totalJobs === 0) {
      return "";
    }

    if (applyCount > 0) {
      return `Prioritise your ${applyCount} APPLY ${
        applyCount === 1 ? "role" : "roles"
      } first, then tailor your ${tailorCount} conditional ${
        tailorCount === 1 ? "role" : "roles"
      }. Avoid spending further effort on the ${skipCount} structurally blocked ${
        skipCount === 1 ? "role" : "roles"
      }.`;
    }

    if (tailorCount > 0) {
      return `No clear APPLY roles are currently in your portfolio. Focus on tailoring the ${tailorCount} conditional ${
        tailorCount === 1 ? "role" : "roles"
      } and avoid the ${skipCount} structurally blocked ${
        skipCount === 1 ? "role" : "roles"
      }.`;
    }

    return "All saved roles are currently structurally blocked. Consider reallocating your next applications toward roles with fewer eligibility barriers.";
  }

  // -----------------------
  // EVIDENCE HIGHLIGHT
  // -----------------------

  function renderHighlightedText() {
    if (!verdict?.evidence) {
      return adText;
    }

    const { start, end } = verdict.evidence;

    // Semantic highlight colour based on verdict status
    const markClass =
      verdict.status === "APPLY"
        ? "rounded px-0.5 bg-green-100 text-green-900 font-medium"
        : verdict.status === "TAILOR"
        ? "rounded px-0.5 bg-amber-100 text-amber-900 font-medium"
        : "rounded px-0.5 bg-red-100 text-red-900 font-medium";

    return (
      <>
        {adText.slice(0, start)}

        <mark className={markClass}>{adText.slice(start, end)}</mark>

        {adText.slice(end)}
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
      {/* ── HEADER ───────────────────────────────────────────── */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 py-5">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900">
                Job Eligibility Decoder
              </h1>
              <p className="mt-0.5 text-base font-medium text-gray-500">
                Know before you apply.
              </p>
            </div>
            <p className="hidden text-right text-xs text-gray-400 sm:block">
              Decision support only — not migration advice.
            </p>
          </div>
          <p className="mt-2 text-sm text-gray-600">
            Check structural eligibility requirements and role fit before
            spending time on an application.
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* ── YOUR PROFILE ─────────────────────────────────────── */}
        <section className="mb-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-5 text-base font-semibold text-gray-700">
            Your Profile
          </h2>

          {/* Two equal columns side-by-side on desktop, stacked on mobile */}
          <div className="flex flex-col gap-6 md:flex-row md:gap-0">
            {/* VISA column */}
            <div className="flex-1 md:pr-6">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
                Visa
              </p>
              <div className="flex flex-col gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Visa subclass
                  </label>
                  <select
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
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Currently in study term?
                  </label>
                  <select
                    value={duringStudyTerm ? "yes" : "no"}
                    onChange={(e) => {
                      setDuringStudyTerm(e.target.value === "yes");
                      resetAnalysis();
                      resetJobSuggestions();
                    }}
                    disabled={visaSubclass !== "500"}
                    className="w-full rounded-lg border border-gray-300 bg-white p-2.5 text-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                  >
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Months remaining
                  </label>
                  <input
                    type="number"
                    min="0"
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
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
                Career
              </p>
              <div className="flex flex-col gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Target field
                  </label>
                  <input
                    type="text"
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
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Preferred location
                  </label>
                  <input
                    type="text"
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
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Years of experience
                  </label>
                  <input
                    type="number"
                    min="0"
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
        </section>

        {/* ── JOB ADVERTISEMENT INPUT ──────────────────────────── */}
        <section className="mb-8">
          <div className="mb-3">
            <h2 className="text-base font-semibold text-gray-900">
              Job advertisement
            </h2>
            <p className="mt-0.5 text-sm text-gray-500">
              Paste the full advertisement below. We&apos;ll identify explicit
              eligibility requirements and fit signals.
            </p>
          </div>

          <textarea
            value={adText}
            onChange={(e) => {
              setAdText(e.target.value);
              resetAnalysis();
            }}
            placeholder="Paste job advertisement here…"
            className="min-h-56 w-full rounded-xl border border-gray-300 bg-white p-5 text-sm leading-7 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-200"
          />

          <div className="mt-4">
            <button
              onClick={handleAnalyse}
              disabled={!adText.trim() || isLoading}
              className="rounded-lg bg-gray-900 px-6 py-3 text-sm font-semibold text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isLoading ? "Analysing…" : "Analyse Job"}
            </button>
          </div>
        </section>

        {/* ── ANALYSIS RESULTS — TWO-COLUMN ────────────────────── */}
        {verdict && (
          <section className="mb-10">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
              {/* LEFT COLUMN — Analysed advertisement (55%) */}
              <div className="lg:w-[55%]">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-gray-400">
                  Analysed job advertisement
                </h2>

                <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                  <div className="whitespace-pre-wrap text-sm leading-7 text-gray-800">
                    {renderHighlightedText()}
                  </div>
                </div>
              </div>

              {/* RIGHT COLUMN — Decision panel (45%), sticky */}
              <div className="lg:sticky lg:top-6 lg:w-[45%]">
                {/* VERDICT CARD */}
                {vc && (
                  <div className={`rounded-xl border p-6 shadow-sm ${vc.card}`}>
                    {/* Verdict + source badge */}
                    <div className="flex items-start justify-between gap-3">
                      <span
                        className={`inline-block rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${vc.badge}`}
                      >
                        {verdict.status}
                      </span>

                      {analysisSource && (
                        <span className="rounded-full border border-gray-200 bg-white px-2.5 py-0.5 text-xs text-gray-500">
                          {analysisSource === "AI"
                            ? "AI extraction"
                            : "Local fallback"}
                        </span>
                      )}
                    </div>

                    {/* Reason */}
                    <p
                      className={`mt-3 text-sm font-medium leading-6 ${vc.heading}`}
                    >
                      {verdict.reason}
                    </p>

                    {/* Triggering evidence */}
                    {verdict.evidence && (
                      <div className={`mt-4 rounded-lg p-4 ${vc.evidence}`}>
                        <p
                          className={`mb-1.5 text-xs font-semibold uppercase tracking-wide ${vc.evidenceLabel}`}
                        >
                          Why?
                        </p>
                        <p className={`text-sm leading-6 ${vc.evidenceText}`}>
                          &ldquo;{verdict.evidence.text}&rdquo;
                        </p>
                      </div>
                    )}

                    {/* Rule ID */}
                    {verdict.ruleId && (
                      <p className="mt-3 text-xs text-gray-400">
                        Rule:{" "}
                        <code className="font-mono">{verdict.ruleId}</code>
                      </p>
                    )}

                    {/* Add to Portfolio */}
                    <button
                      onClick={addToPortfolio}
                      className="mt-5 w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Add to Portfolio
                    </button>
                  </div>
                )}

                {/* FIT SIGNALS */}
                {fitSignals.length > 0 && (
                  <div className="mt-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <h3 className="text-sm font-semibold text-gray-700">
                      Fit signals
                    </h3>
                    <p className="mt-0.5 text-xs text-gray-400">
                      These signals help prioritise roles but do not change the
                      eligibility verdict.
                    </p>

                    <div className="mt-3 space-y-2">
                      {fitSignals.map((signal) => (
                        <div
                          key={signal.id}
                          className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3"
                        >
                          <span
                            className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                              signal.status === "MATCH"
                                ? "bg-green-100 text-green-800"
                                : signal.status === "STRETCH"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-blue-100 text-blue-800"
                            }`}
                          >
                            {signal.status === "MATCH"
                              ? "✓"
                              : signal.status === "STRETCH"
                              ? "△"
                              : "i"}
                          </span>

                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-800">
                              {signal.label}
                            </p>
                            <p className="mt-0.5 text-xs text-gray-500">
                              {signal.reason}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ── APPLICATION PORTFOLIO ────────────────────────────── */}
        {savedJobs.length > 0 && (
          <section className="mb-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-6 flex items-baseline justify-between gap-4">
              <h2 className="text-xl font-bold text-gray-900">
                Application Portfolio
              </h2>
              <span className="text-sm text-gray-400">
                {totalJobs} job{totalJobs === 1 ? "" : "s"} analysed
              </span>
            </div>

            {/* Summary counts */}
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-gray-200 p-4">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
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
            <div className="mt-5 rounded-lg border border-red-100 bg-red-50 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-600">
                Application effort leak
              </p>
              <p className="mt-1 text-4xl font-bold text-red-900">
                {effortLeak}%
              </p>
              <p className="mt-1.5 text-sm text-red-700">
                {effortLeak}% of your current application portfolio is going
                toward roles with structural eligibility blockers.
              </p>
            </div>

            {/* Recommendation */}
            <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">
                Recommended reallocation
              </p>
              <p className="mt-2 text-sm leading-6 text-blue-900">
                {getRecommendation()}
              </p>
            </div>

            {/* Ranked jobs */}
            <div className="mt-6">
              <div className="mb-3 flex items-baseline justify-between">
                <h3 className="text-sm font-semibold text-gray-700">
                  Priority order
                </h3>
                <p className="text-xs text-gray-400">
                  APPLY first, then TAILOR, then SKIP
                </p>
              </div>

              <div className="space-y-2">
                {rankedJobs.map((job) => (
                  <div
                    key={job.id}
                    className="flex items-start justify-between gap-4 rounded-lg border border-gray-100 p-4 hover:bg-gray-50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900">
                        {job.title}
                      </p>
                      <p className="mt-0.5 text-xs text-gray-500">
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
                        className="rounded px-2 py-1 text-sm text-gray-300 hover:bg-gray-100 hover:text-gray-600"
                        aria-label="Remove job from portfolio"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ── SUGGESTED JOBS ──────────────────────────────────── */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                Next applications
              </p>
              <h2 className="mt-1 text-xl font-bold text-gray-900">
                Suggested jobs
              </h2>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-500">
                Find up to 10 current roles based on your target field and
                preferred location.
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

          <p className="mt-3 text-sm text-gray-500">
            Heuristic ranking of up to 30 Adzuna snippets. Scores are not eligibility
            verdicts; use the full advertisement in the decoder to check eligibility.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-gray-500">
            <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1">
              Field: {targetField || "Not set"}
            </span>

            <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1">
              Location: {preferredLocation || "Australia"}
            </span>
          </div>

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
                      className="flex h-full flex-col rounded-xl border border-gray-200 bg-white p-5 transition hover:border-gray-300 hover:shadow-sm"
                    >
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {job.category && (
                            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
                              {job.category}
                            </span>
                          )}

                          {job.contractTime && (
                            <span className="rounded-full border border-gray-200 px-2.5 py-1 text-xs text-gray-500">
                              {job.contractTime.replaceAll("_", " ")}
                            </span>
                          )}

                          {job.contractType && (
                            <span className="rounded-full border border-gray-200 px-2.5 py-1 text-xs text-gray-500">
                              {job.contractType.replaceAll("_", " ")}
                            </span>
                          )}
                        </div>

                        {!job.contractTime && !job.contractType && (
                          <p className="mt-2 text-xs text-gray-500">Contract information not listed</p>
                        )}
                        <h3 className="mt-3 text-base font-semibold leading-6 text-gray-900">
                          {job.title}
                        </h3>

                        <p className="mt-1 text-sm font-medium text-gray-600">
                          {job.company}
                        </p>

                        <p className="mt-1 text-sm text-gray-500">
                          {job.location}
                        </p>

                        {salary && (
                          <p className="mt-2 text-sm font-semibold text-gray-800">
                            {salary}
                          </p>
                        )}

                        <div className="mt-3 border-t border-gray-100 pt-3">
                          <p className="text-sm text-gray-600">
                            <span className="text-lg font-semibold text-gray-900">{job.recommendation.score}%</span>{" "}
                            profile match
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
                          <p className="mt-3 text-sm leading-6 text-gray-600">
                            {getDescriptionPreview(job.description)}
                          </p>
                        )}
                      </div>

                      <div className="mt-5 flex items-center justify-between gap-3 border-t border-gray-100 pt-4">
                        <span className="text-xs text-gray-400">
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
    </main>
  );
}
