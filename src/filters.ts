import type { Job, ProfileRules } from "./types.ts";

export type FilterResult = { pass: true } | { pass: false; reason: string };

// Whole-word, case-insensitive match, so "go" doesn't hit "Google" and "java" doesn't hit "javascript".
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const has = (haystack: string, needles: string[]) =>
  needles.find((n) => new RegExp(`(^|[^a-z0-9])${escape(n.toLowerCase())}($|[^a-z0-9])`).test(haystack.toLowerCase()));

// Cheap, deterministic checks that run before any model call.
// Anything they cannot decide (e.g. a residency clause buried in the text) is left to the model.
export function prefilter(job: Job, rules: ProfileRules, now = new Date()): FilterResult {
  if (!has(job.title, rules.titleInclude)) return { pass: false, reason: "title: not a target role" };

  const excluded = has(job.title, rules.titleExclude);
  if (excluded) return { pass: false, reason: `title: excluded keyword "${excluded}"` };

  const loc = has(job.location, rules.locationExclude);
  if (loc) return { pass: false, reason: `location: excluded "${loc}"` };

  if (job.postedAt) {
    const ageDays = (now.getTime() - new Date(job.postedAt).getTime()) / 86_400_000;
    if (ageDays > rules.maxAgeDays) return { pass: false, reason: `age: ${Math.floor(ageDays)} days old` };
  }

  if (job.salaryMonthlyUsd && job.salaryMonthlyUsd.max < rules.minMonthlyUsd) {
    return { pass: false, reason: `salary: tops out at USD ${job.salaryMonthlyUsd.max}/month` };
  }

  return { pass: true };
}
