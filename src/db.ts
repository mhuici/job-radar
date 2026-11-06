import { createClient } from "@supabase/supabase-js";
import type { Assessment, Job, Profile } from "./types.ts";

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const check = <T>(r: { data: T; error: any }) => {
  if (r.error) throw new Error(r.error.message);
  return r.data;
};

export async function activeProfiles(): Promise<Profile[]> {
  return check(await db.from("profiles").select("*").eq("active", true)) as Profile[];
}

export async function upsertJobs(jobs: Job[]) {
  for (let i = 0; i < jobs.length; i += 500) {
    const rows = jobs.slice(i, i + 500).map((j) => ({
      id: j.id, source: j.source, company: j.company, title: j.title, url: j.url,
      location: j.location, posted_at: j.postedAt, salary_monthly_usd: j.salaryMonthlyUsd,
    }));
    check(await db.from("jobs").upsert(rows, { onConflict: "id", ignoreDuplicates: true }));
  }
}

export async function screenedIds(profileId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const rows = check(await db.from("screenings").select("job_id").eq("profile_id", profileId).range(from, from + 999)) as { job_id: string }[];
    rows.forEach((r) => ids.add(r.job_id));
    if (rows.length < 1000) return ids;
  }
}

export async function saveScreenings(
  rows: { job_id: string; profile_id: string; stage: "prefilter" | "model"; decision: string; reason: string; fit?: number; details?: Assessment }[],
) {
  for (let i = 0; i < rows.length; i += 500) {
    check(await db.from("screenings").upsert(rows.slice(i, i + 500), { onConflict: "job_id,profile_id", ignoreDuplicates: true }));
  }
}

export async function startRun(): Promise<number> {
  const row = check(await db.from("runs").insert({}).select("id").single()) as { id: number };
  return row.id;
}

export async function finishRun(id: number, stats: object, errors: string[]) {
  check(await db.from("runs").update({ finished_at: new Date().toISOString(), stats, errors }).eq("id", id));
}
