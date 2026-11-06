import { readFileSync } from "node:fs";
import { fetchAll, type SourceConfig } from "./sources.ts";
import { prefilter } from "./filters.ts";
import type { Assessment, Job, Profile } from "./types.ts";
import type { Pick } from "./notify.ts";

const DRY_RUN = process.env.DRY_RUN === "1"; // no database, no email: prints the digest instead
const MAX_ASSESS = Number(process.env.MAX_ASSESS ?? 30); // per profile per run; the rest waits for tomorrow

const readJson = (p: string) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));

// Small concurrency pool so model calls don't hit rate limits.
async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const out: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = { status: "fulfilled", value: await fn(items[i]) }; }
      catch (e) { out[i] = { status: "rejected", reason: e }; }
    }
  }));
  return out;
}

async function main() {
  const db = DRY_RUN ? null : await import("./db.ts");
  const { assess } = await import("./assess.ts");
  const notify = await import("./notify.ts");

  const runId = db ? await db.startRun() : 0;
  const sources: SourceConfig[] = readJson("config/sources.json");
  const profiles: Profile[] = db ? await db.activeProfiles() : [readJson("config/profile.example.json")];

  const { jobs, errors } = await fetchAll(sources);
  if (db) await db.upsertJobs(jobs);
  const stats: Record<string, unknown> = { fetched: jobs.length, sources: sources.length };

  for (const profile of profiles) {
    const seen = db ? await db.screenedIds(profile.id) : new Set<string>();
    const fresh = jobs.filter((j) => !seen.has(j.id));

    const passed: Job[] = [];
    const prefilterRows = [];
    for (const job of fresh) {
      const r = prefilter(job, profile.rules);
      if (r.pass) passed.push(job);
      else prefilterRows.push({ job_id: job.id, profile_id: profile.id, stage: "prefilter" as const, decision: "discard", reason: r.reason });
    }

    // Newest first; anything over the cap is not recorded, so it is picked up next run.
    const toAssess = passed.sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? "")).slice(0, MAX_ASSESS);
    const results = await pool(toAssess, 4, (job) => assess(job, profile));

    const picks: { job: Job; a: Assessment }[] = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") picks.push({ job: toAssess[i], a: r.value });
      else errors.push(`assess ${toAssess[i].id}: ${r.reason?.message ?? r.reason}`);
    });

    const byFit = (x: Pick, y: Pick) => y.a.fit - x.a.fit;
    const suggested = picks.filter((p) => p.a.decision === "suggest").sort(byFit).slice(0, 8);
    const review = picks.filter((p) => p.a.decision === "review").sort(byFit).slice(0, 5);
    const discarded = prefilterRows.length + picks.filter((p) => p.a.decision === "discard").length;

    const html = notify.renderDigest(profile, suggested, review, discarded);
    if (db) {
      await db.saveScreenings([
        ...prefilterRows,
        ...picks.map(({ job, a }) => ({
          job_id: job.id, profile_id: profile.id, stage: "model" as const,
          decision: a.decision, reason: a.reason, fit: a.fit, details: a,
        })),
      ]);
      await notify.sendDigest(profile, html, suggested.length + review.length);
    } else {
      console.log(html);
    }

    stats[profile.id] = {
      new: fresh.length, prefiltered_out: prefilterRows.length, assessed: picks.length,
      deferred: passed.length - toAssess.length, suggested: suggested.length, review: review.length,
    };
  }

  if (db) await db.finishRun(runId, stats, errors);
  console.log(JSON.stringify({ stats, errors }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
