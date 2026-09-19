import { recommendJob, type RecommendationProfile } from "../../../../lib/jobRecommendation";

type AdzunaJob = {
  id: string;
  title: string;

  description?: string;

  redirect_url: string;

  created?: string;

  salary_min?: number;
  salary_max?: number;

  contract_type?: string;
  contract_time?: string;

  company?: {
    display_name?: string;
  };

  location?: {
    display_name?: string;
  };

  category?: {
    label?: string;
  };
};

type AdzunaResponse = {
  count?: number;
  results?: AdzunaJob[];
};

export async function GET(request: Request) {
  try {
    const appId = process.env.ADZUNA_APP_ID;

    const appKey = process.env.ADZUNA_APP_KEY;

    if (!appId || !appKey) {
      return Response.json(
        {
          error: "Adzuna API credentials are not configured.",
        },
        {
          status: 500,
        }
      );
    }

    const { searchParams } = new URL(request.url);

    const what = (searchParams.get("targetField") ?? searchParams.get("what"))?.trim();
    const where = (searchParams.get("preferredLocation") ?? searchParams.get("where"))?.trim() ?? "";
    const subclass = searchParams.get("subclass");
    const studyTerm = searchParams.get("duringStudyTerm");
    const years = searchParams.get("yearsExperience");
    const months = searchParams.get("monthsRemaining");
    const nonNegative = (value: string | null) => value !== null && value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0;
    if (!what || !["500", "485"].includes(subclass ?? "") ||
        !["true", "false"].includes(studyTerm ?? "") || !nonNegative(years) ||
        (months !== null && !nonNegative(months))) {
      return Response.json({ error: "Provide targetField, subclass (500 or 485), duringStudyTerm (true or false), and non-negative yearsExperience and optional monthsRemaining." }, { status: 400 });
    }
    const profile: RecommendationProfile = {
      subclass: subclass as "500" | "485",
      duringStudyTerm: studyTerm === "true",
      yearsExperience: Number(years),
      monthsRemaining: months === null ? undefined : Number(months),
      targetField: what,
      preferredLocation: where,
    };

    const adzunaParams = new URLSearchParams({
      app_id: appId,
      app_key: appKey,
      results_per_page: "30",
      what,
      "content-type": "application/json",
    });

    if (where) {
      adzunaParams.set("where", where);
    }

    const adzunaUrl = `https://api.adzuna.com/v1/api/jobs/au/search/1?${adzunaParams.toString()}`;

    const response = await fetch(adzunaUrl, {
      method: "GET",

      headers: {
        Accept: "application/json",
      },

      cache: "no-store",
    });

    if (!response.ok) {
      const body = await response.text();

      console.error("Adzuna API error:", response.status, body);

      return Response.json(
        {
          error: "Failed to retrieve jobs from Adzuna.",
        },
        {
          status: 502,
        }
      );
    }

    const data = (await response.json()) as AdzunaResponse;

    const jobs = (data.results ?? []).map((job) => ({
      id: job.id,

      title: job.title,

      company: job.company?.display_name ?? "Company not listed",

      location: job.location?.display_name ?? "Location not listed",

      description: job.description ?? "",

      redirectUrl: job.redirect_url,

      created: job.created,

      salaryMin: job.salary_min,

      salaryMax: job.salary_max,

      contractType: job.contract_type,

      contractTime: job.contract_time,

      category: job.category?.label,
    }));

    const rankedJobs = jobs
      .map((job) => ({ ...job, recommendation: recommendJob(job, profile) }))
      .sort((a, b) => b.recommendation.score - a.recommendation.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, 10);

    return Response.json({
      query: {
        what,
        where: where ?? null,
      },

      count: data.count ?? jobs.length,

      jobs: rankedJobs,
      scoredCount: jobs.length,
    });
  } catch (error) {
    console.error("Job suggestion error:", error);

    return Response.json(
      {
        error: "Failed to retrieve suggested jobs.",
      },
      {
        status: 500,
      }
    );
  }
}
