-- job-radar schema. Run once in the Supabase SQL editor.
-- The script uses the service role key, so RLS is enabled with no public policies.

create table if not exists profiles (
  id text primary key,
  name text not null,
  email text not null,
  summary text not null,          -- who they are and what they want; sent to the model
  rules jsonb not null,           -- see ProfileRules in src/types.ts
  active boolean not null default true
);

create table if not exists jobs (
  id text primary key,            -- "<source>:<native id>"
  source text not null,
  company text not null,
  title text not null,
  url text not null,
  location text,
  posted_at timestamptz,
  salary_monthly_usd jsonb,
  first_seen timestamptz not null default now()
);

-- One row per (job, profile): the memory that prevents repeats, and the audit trail.
create table if not exists screenings (
  job_id text not null references jobs(id) on delete cascade,
  profile_id text not null references profiles(id) on delete cascade,
  stage text not null check (stage in ('prefilter', 'model')),
  decision text not null check (decision in ('suggest', 'review', 'discard')),
  reason text not null,
  fit int,
  details jsonb,                  -- full model output
  verdict text check (verdict in ('apply', 'skip')),  -- set by the person; used for precision
  created_at timestamptz not null default now(),
  primary key (job_id, profile_id)
);

create table if not exists runs (
  id bigserial primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  stats jsonb,
  errors jsonb
);

alter table profiles enable row level security;
alter table jobs enable row level security;
alter table screenings enable row level security;
alter table runs enable row level security;

-- Precision: of the jobs the agent suggested and the person judged, how many were worth applying to.
create or replace view weekly_precision with (security_invoker = true) as
select
  profile_id,
  date_trunc('week', created_at)::date as week,
  count(*) filter (where decision = 'suggest') as suggested,
  count(*) filter (where decision = 'suggest' and verdict is not null) as judged,
  count(*) filter (where decision = 'suggest' and verdict = 'apply') as accepted,
  round(
    100.0 * count(*) filter (where decision = 'suggest' and verdict = 'apply')
    / nullif(count(*) filter (where decision = 'suggest' and verdict is not null), 0)
  ) as precision_pct
from screenings
group by 1, 2
order by 2 desc, 1;
