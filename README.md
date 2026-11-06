# job-radar

A small scheduled agent that finds remote engineering jobs, screens them for several people, and emails each person a short digest every weekday morning.

I built it for my own job search and to share openings with friends. It is deliberately small: one TypeScript script, four tables, one cron job.

## How it works

```
GitHub Actions (cron, weekdays)
  └─ fetch    public ATS APIs (Greenhouse, Ashby, Lever) + Remote OK
  └─ for each profile:
       ├─ memory      skip jobs already screened for this person      (Supabase)
       ├─ prefilter   deterministic rules: title, location, age, posted pay
       ├─ assess      Claude, forced tool call → structured verdict  (only on survivors, capped)
       ├─ record      every decision + reason                         (audit trail)
       └─ notify      email: "worth applying" + "needs your call"      (Resend)
```

Each assessment returns `suggest`, `review` or `discard`. **`review` is the escalation path:** when the posting leaves a deciding fact unclear (residency rule, employment type, pay), the model is told to hand the call to the person instead of guessing.

## Design decisions

- **Rules before the model.** Most postings are rejected by cheap string checks. The model only sees what those checks can't settle, which keeps cost to cents per day and makes rejections explainable.
- **Structured output by forcing a tool call**, not by parsing prose.
- **Memory is the `screenings` table.** Primary key `(job_id, profile_id)`, so a job is judged once per person and never re-sent. Jobs over the per-run cap are not recorded, so they roll over to the next run.
- **Everything is auditable.** Every screened job has a stage (`prefilter` or `model`), a decision and a reason. Each run stores counts and source errors in `runs`.
- **Precision is measured, not assumed.** People mark suggestions `apply` or `skip` in `screenings.verdict`; the `weekly_precision` view reports what share of suggestions were worth applying to.
- **One failing source doesn't fail the run.** Fetches are settled independently and errors are logged.
- **No agent framework, no queue, no dashboard.** The job runs once a day for a handful of people; anything more would be cost without benefit.

## Setup

1. Create a Supabase project and run [`sql/schema.sql`](sql/schema.sql) in the SQL editor.
2. Add a row to `profiles` per person (see [`config/profile.example.json`](config/profile.example.json) for the shape). Profiles live in the database, not in this repo, so emails stay private.
3. Create a [Resend](https://resend.com) API key. To email anyone other than yourself, verify a sending domain and set `MAIL_FROM`.
4. In the repo settings, add secrets `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, and optional variables `MAIL_FROM` and `MODEL`.
5. Run the **daily** workflow manually with `dry_run` checked to see a digest in the logs.
6. Uncomment the `schedule` block in [`.github/workflows/daily.yml`](.github/workflows/daily.yml) to run it every weekday.

Sources are listed in [`config/sources.json`](config/sources.json); add a company by its Greenhouse, Ashby or Lever board token.

## Local

```bash
npm install
npm test            # filter and parser tests
npm run dry-run     # uses config/profile.example.json, prints the digest, no DB or email
```

## Measuring it

```sql
select * from weekly_precision;
select decision, stage, count(*) from screenings where profile_id = 'mariano' group by 1, 2;
select started_at, stats, errors from runs order by id desc limit 7;
```
