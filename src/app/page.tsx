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

    return (
      <>
        {adText.slice(0, start)}

        <mark className="rounded bg-yellow-200 px-1 text-gray-900">
          {adText.slice(start, end)}
        </mark>

        {adText.slice(end)}
      </>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-8 text-gray-900">
      <div className="mx-auto max-w-3xl">
        {/* HEADER */}

        <h1 className="mb-2 text-3xl font-bold">Job Eligibility Decoder</h1>

        <p className="mb-6 text-gray-600">
          Paste a job advertisement to check eligibility, conditions and fit.
        </p>

        {/* VISA PROFILE */}

        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="mb-4 text-lg font-semibold">Your visa profile</h2>

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium">
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
                className="w-full rounded-lg border border-gray-300 bg-white p-2.5"
              >
                <option value="500">Student visa (500)</option>

                <option value="485">Graduate visa (485)</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">
                Currently in study term?
              </label>

              <select
                value={duringStudyTerm ? "yes" : "no"}
                onChange={(e) => {
                  setDuringStudyTerm(e.target.value === "yes");

                  resetAnalysis();
                }}
                disabled={visaSubclass !== "500"}
                className="w-full rounded-lg border border-gray-300 bg-white p-2.5 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
              >
                <option value="yes">Yes</option>

                <option value="no">No</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">
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
                className="w-full rounded-lg border border-gray-300 bg-white p-2.5"
              />
            </div>
          </div>
        </div>

        {/* CAREER PREFERENCES */}

        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="mb-4 text-lg font-semibold">Career preferences</h2>

          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium">
                Target field
              </label>

              <input
                type="text"
                value={targetField}
                onChange={(e) => {
                  setTargetField(e.target.value);

                  resetAnalysis();
                }}
                className="w-full rounded-lg border border-gray-300 bg-white p-2.5"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">
                Preferred location
              </label>

              <input
                type="text"
                value={preferredLocation}
                onChange={(e) => {
                  setPreferredLocation(e.target.value);

                  resetAnalysis();
                }}
                className="w-full rounded-lg border border-gray-300 bg-white p-2.5"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium">
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
                className="w-full rounded-lg border border-gray-300 bg-white p-2.5"
              />
            </div>
          </div>
        </div>

        {/* JOB AD */}

        <textarea
          value={adText}
          onChange={(e) => {
            setAdText(e.target.value);
            resetAnalysis();
          }}
          placeholder="Paste job advertisement here..."
          className="min-h-64 w-full rounded-lg border border-gray-300 bg-white p-4 placeholder:text-gray-400"
        />

        <button
          onClick={handleAnalyse}
          disabled={!adText.trim() || isLoading}
          className="mt-4 rounded-lg bg-black px-5 py-3 text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isLoading ? "Analysing..." : "Analyse Job"}
        </button>

        {/* RESULT */}

        {verdict && (
          <>
            <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-bold">{verdict.status}</h2>

                  <p className="mt-2">{verdict.reason}</p>
                </div>

                {analysisSource && (
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      analysisSource === "AI"
                        ? "bg-green-100 text-green-800"
                        : "bg-gray-200 text-gray-700"
                    }`}
                  >
                    {analysisSource === "AI"
                      ? "AI extraction"
                      : "Local fallback"}
                  </span>
                )}
              </div>

              {verdict.ruleId && (
                <p className="mt-4 text-sm text-gray-500">
                  Rule: {verdict.ruleId}
                </p>
              )}

              {verdict.evidence && (
                <div className="mt-4 rounded bg-yellow-100 p-3">
                  <p className="text-sm font-semibold">Triggering evidence</p>

                  <p className="mt-1">
                    &quot;
                    {verdict.evidence.text}
                    &quot;
                  </p>
                </div>
              )}

              <button
                onClick={addToPortfolio}
                className="mt-5 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium hover:bg-gray-50"
              >
                Add to Portfolio
              </button>
            </div>

            {/* FIT SIGNALS */}

            {fitSignals.length > 0 && (
              <div className="mt-6 rounded-lg border border-gray-200 bg-white p-6">
                <h3 className="text-lg font-semibold">Fit signals</h3>

                <p className="mt-1 text-sm text-gray-500">
                  These signals help prioritise roles but do not change the
                  eligibility verdict.
                </p>

                <div className="mt-4 space-y-3">
                  {fitSignals.map((signal) => (
                    <div
                      key={signal.id}
                      className="rounded-lg border border-gray-200 p-4"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold ${
                            signal.status === "MATCH"
                              ? "bg-green-100 text-green-800"
                              : signal.status === "STRETCH"
                              ? "bg-yellow-100 text-yellow-800"
                              : "bg-blue-100 text-blue-800"
                          }`}
                        >
                          {signal.status === "MATCH"
                            ? "✓"
                            : signal.status === "STRETCH"
                            ? "△"
                            : "i"}
                        </span>

                        <div>
                          <p className="font-medium">{signal.label}</p>

                          <p className="mt-1 text-sm text-gray-600">
                            {signal.reason}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* HIGHLIGHTED JOB AD */}

            <div className="mt-6 rounded-lg border border-gray-200 bg-white p-6">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
                Analysed Job Advertisement
              </h3>

              <div className="whitespace-pre-wrap leading-7">
                {renderHighlightedText()}
              </div>
            </div>
          </>
        )}

        {/* PORTFOLIO */}

        {savedJobs.length > 0 && (
          <div className="mt-10 rounded-lg border border-gray-200 bg-white p-6">
            <h2 className="text-2xl font-bold">Application Portfolio</h2>

            <p className="mt-1 text-sm text-gray-500">
              {totalJobs} job
              {totalJobs === 1 ? "" : "s"} analysed
            </p>

            {/* SUMMARY */}

            <div className="mt-6 grid gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-gray-200 p-4">
                <p className="text-sm text-gray-500">Total</p>

                <p className="mt-1 text-2xl font-bold">{totalJobs}</p>
              </div>

              <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                <p className="text-sm text-green-700">APPLY</p>

                <p className="mt-1 text-2xl font-bold text-green-800">
                  {applyCount}
                </p>
              </div>

              <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4">
                <p className="text-sm text-yellow-700">TAILOR</p>

                <p className="mt-1 text-2xl font-bold text-yellow-800">
                  {tailorCount}
                </p>
              </div>

              <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                <p className="text-sm text-red-700">SKIP</p>

                <p className="mt-1 text-2xl font-bold text-red-800">
                  {skipCount}
                </p>
              </div>
            </div>

            {/* EFFORT LEAK */}

            <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-5">
              <p className="text-sm font-semibold text-red-800">
                Application effort leak
              </p>

              <p className="mt-2 text-3xl font-bold text-red-900">
                {effortLeak}%
              </p>

              <p className="mt-2 text-sm text-red-800">
                {effortLeak}% of your current application portfolio is going
                toward roles with structural eligibility blockers.
              </p>
            </div>

            {/* RECOMMENDATION */}

            <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-5">
              <p className="text-sm font-semibold text-blue-800">
                Recommended reallocation
              </p>

              <p className="mt-2 text-sm leading-6 text-blue-900">
                {getRecommendation()}
              </p>
            </div>

            {/* RANKED JOBS */}

            <div className="mt-6">
              <h3 className="font-semibold">Priority order</h3>

              <p className="mt-1 text-sm text-gray-500">
                APPLY roles are shown first, followed by TAILOR and SKIP.
              </p>

              <div className="mt-4 space-y-3">
                {rankedJobs.map((job) => (
                  <div
                    key={job.id}
                    className="flex items-start justify-between gap-4 rounded-lg border border-gray-200 p-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{job.title}</p>

                      <p className="mt-1 text-sm text-gray-500">
                        {job.verdict.reason}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          job.verdict.status === "APPLY"
                            ? "bg-green-100 text-green-800"
                            : job.verdict.status === "TAILOR"
                            ? "bg-yellow-100 text-yellow-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {job.verdict.status}
                      </span>

                      <button
                        onClick={() => removeFromPortfolio(job.id)}
                        className="rounded px-2 py-1 text-sm text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                        aria-label="Remove job from portfolio"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
