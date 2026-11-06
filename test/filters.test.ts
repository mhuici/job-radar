import { test } from "node:test";
import assert from "node:assert/strict";
import { prefilter } from "../src/filters.ts";
import { fromAshby, fromGreenhouse, fromLever, htmlToText } from "../src/sources.ts";
import type { Job, ProfileRules } from "../src/types.ts";

const rules: ProfileRules = {
  titleInclude: ["engineer", "developer"],
  titleExclude: ["java", "go", "manager"],
  locationExclude: ["us only", "india"],
  minMonthlyUsd: 5000,
  maxAgeDays: 4,
};
const now = new Date("2026-11-06T12:00:00Z");
const job = (over: Partial<Job>): Job => ({
  id: "x", source: "t", company: "Acme", title: "Senior Full Stack Engineer", url: "https://x",
  location: "Remote - LATAM", text: "", postedAt: "2026-11-05T00:00:00Z", salaryMonthlyUsd: null, ...over,
});

test("passes a fresh, on-target role", () => {
  assert.deepEqual(prefilter(job({}), rules, now), { pass: true });
});

test("title rules use whole words", () => {
  assert.equal(prefilter(job({ title: "Senior Java Engineer" }), rules, now).pass, false);
  assert.equal(prefilter(job({ title: "JavaScript Engineer" }), rules, now).pass, true);
  assert.equal(prefilter(job({ title: "Go Developer" }), rules, now).pass, false);
  assert.equal(prefilter(job({ title: "Google Ads Engineer" }), rules, now).pass, true);
  assert.equal(prefilter(job({ title: "Product Designer" }), rules, now).pass, false);
});

test("location, age and posted pay", () => {
  assert.equal(prefilter(job({ location: "Bengaluru, India" }), rules, now).pass, false);
  assert.equal(prefilter(job({ postedAt: "2026-10-01T00:00:00Z" }), rules, now).pass, false);
  assert.equal(prefilter(job({ salaryMonthlyUsd: { min: 3200, max: 3700 } }), rules, now).pass, false);
  assert.equal(prefilter(job({ salaryMonthlyUsd: { min: 4500, max: 6000 } }), rules, now).pass, true);
  assert.equal(prefilter(job({ postedAt: null }), rules, now).pass, true, "unknown date is left to the model");
});

test("normalizes Ashby, Greenhouse and Lever payloads", () => {
  const [a] = fromAshby("checkly", { jobs: [{
    id: "1", title: "Product Engineer", jobUrl: "https://a", location: "Remote", workplaceType: "Remote",
    descriptionPlain: "Build things", publishedAt: "2026-11-01",
    compensation: { summaryComponents: [{ compensationType: "Salary", minValue: 120000, maxValue: 144000, interval: "1 YEAR", currencyCode: "USD" }] },
  }] });
  assert.equal(a.id, "ashby:checkly:1");
  assert.deepEqual(a.salaryMonthlyUsd, { min: 10000, max: 12000 });

  const [g] = fromGreenhouse("acme", { jobs: [{ id: 7, title: "Dev", absolute_url: "https://g", location: { name: "Argentina" }, content: "&lt;p&gt;Hello &amp;amp; bye&lt;/p&gt;" }] });
  assert.equal(g.text, "Hello & bye");

  const [l] = fromLever("blue", [{ id: "z", text: "Engineer", hostedUrl: "https://l", categories: { location: "LATAM" }, createdAt: 0, salaryRange: { min: 30, max: 40, interval: "per-hour-wage", currency: "USD" } }]);
  assert.deepEqual(l.salaryMonthlyUsd, { min: 5190, max: 6920 });
});

test("htmlToText strips tags and keeps line breaks", () => {
  assert.equal(htmlToText("<p>One</p><ul><li>Two</li></ul>"), "One\n Two");
});
