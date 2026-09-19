"use client";

import { useState } from "react";
import { mockExtractJobAd } from "../lib/mockExtraction";
import { evaluateJob, Verdict } from "../lib/rules";
import { ExtractedJobAd } from "../types/job";

type AnalysisSource = "AI" | "LOCAL";

export default function Home() {
  const [adText, setAdText] = useState("");
  const [verdict, setVerdict] = useState<Verdict | null>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [analysisSource, setAnalysisSource] = useState<AnalysisSource | null>(
    null
  );

  async function handleAnalyse() {
    if (!adText.trim()) {
      return;
    }

    setIsLoading(true);
    setVerdict(null);
    setAnalysisSource(null);

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

      const result = evaluateJob(extracted);

      setVerdict(result);
      setAnalysisSource("AI");
    } catch (error) {
      console.warn("AI extraction unavailable. Using local fallback.", error);

      const extracted = mockExtractJobAd(adText);
      const result = evaluateJob(extracted);

      setVerdict(result);
      setAnalysisSource("LOCAL");
    } finally {
      setIsLoading(false);
    }
  }

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
        <h1 className="mb-2 text-3xl font-bold text-gray-900">
          Job Eligibility Decoder
        </h1>

        <p className="mb-6 text-gray-600">
          Paste a job advertisement to check for eligibility blockers.
        </p>

        <textarea
          value={adText}
          onChange={(e) => {
            setAdText(e.target.value);
            setVerdict(null);
            setAnalysisSource(null);
          }}
          placeholder="Paste job advertisement here..."
          className="min-h-64 w-full rounded-lg border border-gray-300 bg-white p-4 text-gray-900 placeholder:text-gray-400"
        />

        <button
          onClick={handleAnalyse}
          disabled={!adText.trim() || isLoading}
          className="mt-4 rounded-lg bg-black px-5 py-3 text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isLoading ? "Analysing..." : "Analyse Job"}
        </button>

        {verdict && (
          <>
            <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6 text-gray-900">
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

                  <p className="mt-1">&quot;{verdict.evidence.text}&quot;</p>
                </div>
              )}
            </div>

            <div className="mt-6 rounded-lg border border-gray-200 bg-white p-6 text-gray-900">
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
                Analysed Job Advertisement
              </h3>

              <div className="whitespace-pre-wrap leading-7">
                {renderHighlightedText()}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
