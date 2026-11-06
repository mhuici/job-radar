import { Resend } from "resend";
import type { Assessment, Job, Profile } from "./types.ts";

export type Pick = { job: Job; a: Assessment };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function item({ job, a }: Pick) {
  return `<li style="margin-bottom:14px">
  <a href="${esc(job.url)}"><b>${esc(job.company)} — ${esc(job.title)}</b></a> <span style="color:#666">(fit ${a.fit})</span><br>
  ${esc(a.reason)}<br>
  <span style="color:#555">Location: ${esc(a.location_rule)} · Hiring: ${esc(a.hiring_model)} · Pay: ${esc(a.salary)} · Ask: ${esc(a.ask)}</span>
</li>`;
}

export function renderDigest(profile: Profile, suggested: Pick[], review: Pick[], discardedCount: number) {
  const sections = [
    suggested.length ? `<h3>Worth applying (${suggested.length})</h3><ol>${suggested.map(item).join("")}</ol>` : "",
    review.length ? `<h3>Needs your call (${review.length})</h3><p style="color:#666">A key fact is missing or ambiguous.</p><ol>${review.map(item).join("")}</ol>` : "",
  ].join("");
  return `<div style="font-family:system-ui,sans-serif;max-width:640px">
<p>Hi ${esc(profile.name)},</p>
${sections || "<p>Nothing new matched your filters today.</p>"}
<p style="color:#888;font-size:12px">${discardedCount} other new postings were screened out. Sent by job-radar.</p>
</div>`;
}

export async function sendDigest(profile: Profile, html: string, count: number) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: process.env.MAIL_FROM || "job-radar <onboarding@resend.dev>",
    to: profile.email,
    subject: count ? `${count} remote roles for you today` : "No new matches today",
    html,
  });
  if (error) throw new Error(`resend: ${error.message}`);
}
