import type { Job } from "./types.ts";

export type SourceConfig = { ats: "greenhouse" | "ashby" | "lever"; token: string } | { ats: "remoteok"; tag: string };

const MAX_TEXT = 6000; // enough for the model to judge location and hiring rules

const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");

// Greenhouse sends escaped HTML whose text is escaped again, so decode on both sides of the tag strip.
export function htmlToText(html: string): string {
  return decode(decode(html)
    .replace(/<(br|\/p|\/li|\/h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    .slice(0, MAX_TEXT);
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { "User-Agent": "job-radar (+https://github.com/mhuici/job-radar)" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

// Monthly USD from an annual or hourly range; null for other currencies or units.
function monthly(min: number | undefined, max: number | undefined, interval: string, currency = "USD") {
  if (!min && !max) return null;
  if (currency.toUpperCase() !== "USD") return null;
  const factor = /hour/i.test(interval) ? 173 : /month/i.test(interval) ? 1 : /year|annual/i.test(interval) ? 1 / 12 : null;
  if (factor === null) return null;
  const lo = Math.round((min ?? max!) * factor);
  const hi = Math.round((max ?? min!) * factor);
  return { min: lo, max: hi };
}

export function fromGreenhouse(token: string, data: any): Job[] {
  return (data.jobs ?? []).map((j: any) => ({
    id: `greenhouse:${token}:${j.id}`,
    source: `greenhouse:${token}`,
    company: j.company_name ?? token,
    title: j.title,
    url: j.absolute_url,
    location: j.location?.name ?? "",
    text: htmlToText(j.content ?? ""),
    postedAt: j.first_published ?? j.updated_at ?? null,
    salaryMonthlyUsd: null,
  }));
}

export function fromAshby(org: string, data: any): Job[] {
  return (data.jobs ?? []).filter((j: any) => j.isListed !== false).map((j: any) => {
    const comp = j.compensation?.summaryComponents?.find((c: any) => c.compensationType === "Salary");
    return {
      id: `ashby:${org}:${j.id}`,
      source: `ashby:${org}`,
      company: org,
      title: j.title,
      url: j.jobUrl ?? j.applyUrl,
      location: [j.location, j.workplaceType, ...(j.secondaryLocations ?? []).map((l: any) => l.location)].filter(Boolean).join(" | "),
      text: (j.descriptionPlain ?? htmlToText(j.descriptionHtml ?? "")).slice(0, MAX_TEXT),
      postedAt: j.publishedAt ?? null,
      salaryMonthlyUsd: comp ? monthly(comp.minValue, comp.maxValue, comp.interval ?? "", comp.currencyCode) : null,
    };
  });
}

export function fromLever(company: string, data: any[]): Job[] {
  return (data ?? []).map((j: any) => ({
    id: `lever:${company}:${j.id}`,
    source: `lever:${company}`,
    company,
    title: j.text,
    url: j.hostedUrl,
    location: [j.categories?.location, ...(j.categories?.allLocations ?? []), j.workplaceType].filter(Boolean).join(" | "),
    text: [j.descriptionPlain, ...(j.lists ?? []).map((l: any) => `${l.text}\n${htmlToText(l.content ?? "")}`), j.additionalPlain]
      .filter(Boolean).join("\n").slice(0, MAX_TEXT),
    postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
    salaryMonthlyUsd: j.salaryRange ? monthly(j.salaryRange.min, j.salaryRange.max, j.salaryRange.interval ?? "", j.salaryRange.currency) : null,
  }));
}

export function fromRemoteOk(data: any[]): Job[] {
  return (data ?? []).filter((j: any) => j.id && j.position).map((j: any) => ({
    id: `remoteok:${j.id}`,
    source: "remoteok",
    company: j.company,
    title: j.position,
    url: j.url,
    location: j.location ?? "",
    text: htmlToText(j.description ?? ""),
    postedAt: j.date ?? null,
    salaryMonthlyUsd: j.salary_max ? monthly(j.salary_min, j.salary_max, "year") : null,
  }));
}

export async function fetchSource(s: SourceConfig): Promise<Job[]> {
  switch (s.ats) {
    case "greenhouse":
      return fromGreenhouse(s.token, await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(s.token)}/jobs?content=true`));
    case "ashby":
      return fromAshby(s.token, await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(s.token)}?includeCompensation=true`));
    case "lever":
      return fromLever(s.token, await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(s.token)}?mode=json`));
    case "remoteok":
      return fromRemoteOk(await getJson(`https://remoteok.com/api?tag=${encodeURIComponent(s.tag)}`));
  }
}

// One failing board must not sink the run; failures are reported in the run log.
export async function fetchAll(sources: SourceConfig[]) {
  const results = await Promise.allSettled(sources.map(fetchSource));
  const jobs = new Map<string, Job>();
  const errors: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") r.value.forEach((j) => jobs.set(j.id, j));
    else errors.push(`${JSON.stringify(sources[i])}: ${r.reason?.message ?? r.reason}`);
  });
  return { jobs: [...jobs.values()], errors };
}
