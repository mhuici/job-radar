export type Job = {
  id: string; // "<source>:<native id>", stable across runs
  source: string; // greenhouse:<token> | ashby:<org> | lever:<company> | remoteok
  company: string;
  title: string;
  url: string;
  location: string;
  text: string; // plain-text description, trimmed
  postedAt: string | null; // ISO date
  salaryMonthlyUsd: { min: number; max: number } | null; // only when the source gives structured data
};

export type ProfileRules = {
  titleInclude: string[]; // at least one must match (case-insensitive substring)
  titleExclude: string[]; // none may match
  locationExclude: string[]; // any match in the location field discards
  minMonthlyUsd: number; // discard when a posted range tops out below this
  maxAgeDays: number;
};

export type Profile = {
  id: string;
  name: string;
  email: string;
  summary: string; // who they are and what they want, in plain words; sent to the model
  rules: ProfileRules;
  active: boolean;
};

export type Decision = "suggest" | "review" | "discard";

export type Assessment = {
  decision: Decision;
  fit: number; // 0-100
  reason: string;
  location_rule: string;
  hiring_model: string;
  salary: string;
  ask: string;
};
