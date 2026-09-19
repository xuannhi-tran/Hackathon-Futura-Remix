"use client";

import { useState } from "react";

import { mockExtractJobAd } from "../lib/mockExtraction";
import { getDemoFixture } from "../lib/demoFixtures";

import { evaluateJob, evaluateFitSignals } from "../lib/rules";

import { ExtractedJobAd, SavedJob, Verdict, FitSignal } from "../types/job";

type AnalysisSource = "AI" | "LOCAL";

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

  function resetAnalysis() {
    setVerdict(null);
    setFitSignals([]);
    setAnalysisSource(null);
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
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
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
      </div>
    </main>
  );
}
