import Anthropic from "@anthropic-ai/sdk";
import type { Assessment, Job, Profile } from "./types.ts";

const MODEL = process.env.MODEL || "claude-haiku-4-5";
let client: Anthropic | undefined; // created on first use so dry runs work without a key

// Forcing a tool call gives us structured output without parsing free text.
const tool: Anthropic.Tool = {
  name: "record_assessment",
  description: "Record the assessment of one job posting for one candidate.",
  input_schema: {
    type: "object",
    properties: {
      decision: {
        type: "string",
        enum: ["suggest", "review", "discard"],
        description:
          "suggest: clearly eligible and a good fit. discard: clearly ineligible or a poor fit. review: a key fact (residency rule, employment type, pay) is missing or ambiguous, so a human should decide.",
      },
      fit: { type: "integer", minimum: 0, maximum: 100 },
      reason: { type: "string", description: "One sentence. For discards, the single deciding reason." },
      location_rule: { type: "string", description: "Who can apply, as stated in the posting, or 'not stated'." },
      hiring_model: { type: "string", description: "Contractor, employee, EOR, freelance, or 'not stated'." },
      salary: { type: "string", description: "Posted pay with unit, or 'not posted'." },
      ask: { type: "string", description: "Suggested ask following the candidate's salary rule, in the posting's unit." },
    },
    required: ["decision", "fit", "reason", "location_rule", "hiring_model", "salary", "ask"],
  },
};

export async function assess(job: Job, profile: Profile): Promise<Assessment> {
  client ??= new Anthropic();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name },
    system:
      "You screen job postings for one candidate. Judge only from the posting text; never assume facts it does not state. " +
      "If eligibility depends on something the posting leaves unclear, choose 'review' instead of guessing.",
    messages: [
      {
        role: "user",
        content:
          `CANDIDATE\n${profile.summary}\n\n` +
          `POSTING\nCompany: ${job.company}\nTitle: ${job.title}\nLocation field: ${job.location || "(empty)"}\nURL: ${job.url}\n\n${job.text}`,
      },
    ],
  });
  const block = msg.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error(`no tool call for ${job.id}`);
  return block.input as Assessment;
}
