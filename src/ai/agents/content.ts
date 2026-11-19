/**
 * Provider-based drafting agents (Milestone 6).
 *
 * These agents ask the configured provider (Workers AI by default, mock
 * in tests/local dev) to draft text. Every output is labelled as AI
 * output in the UI, and nothing is published by these agents — drafts
 * become `create_post` proposals (draft status) that follow the site's
 * operating mode (manual: never applied; supervised: approval required;
 * autonomous: low-risk draft creation auto-applies).
 */
import type { AgentContext, AgentDefinition, AgentResult } from "../types";

function draftTitle(input: string): string {
  const topic = input.replace(/\s+/g, " ").trim().slice(0, 60);
  return topic === "" ? "AI draft" : `AI draft: ${topic}`;
}

async function complete(ctx: AgentContext, system: string, prompt: string): Promise<string> {
  const result = await ctx.provider.complete(ctx.env, prompt, {
    system,
    maxTokens: 1024,
    temperature: 0.7,
  });
  return result.text;
}

export const contentWriter: AgentDefinition = {
  id: "content-writer",
  name: "Content Writer",
  description:
    "Drafts a blog post on a topic you give it, using the site's title, tagline and published posts as context. The draft is proposed as a new draft post — never published by the agent.",
  capabilities: ["Draft blog posts", "Use website memory as context", "Propose a draft post for review"],
  risk: "low",
  requiresProvider: true,
  async run(ctx: AgentContext): Promise<AgentResult> {
    const prompt = `${ctx.memoryText}\n\nWrite a blog post draft about: ${ctx.input}\nUse clear headings and a short introduction. Do not invent facts about the site that are not in the memory above.`;
    const text = await complete(
      ctx,
      "You are a careful blog writer for a WordPress-style site. Write in plain, useful English.",
      prompt,
    );
    return {
      summary: `Drafted a post about "${ctx.input.slice(0, 80)}" (AI draft — not published).`,
      output: text,
      proposals: [
        {
          type: "create_post",
          summary: `Create draft post "${draftTitle(ctx.input)}"`,
          risk: "low",
          payload: { title: draftTitle(ctx.input), content: text, status: "draft", type: "post" },
        },
      ],
    };
  },
};

export const researchAssistant: AgentDefinition = {
  id: "research-assistant",
  name: "Research Assistant",
  description:
    "Researches a topic and writes a structured summary. It cannot browse the live web in M6 — it works from the provider's knowledge and the site's own memory, and says so in its output.",
  capabilities: ["Summarise a topic", "Structure findings with headings", "Propose the summary as a draft post"],
  risk: "low",
  requiresProvider: true,
  async run(ctx: AgentContext): Promise<AgentResult> {
    const prompt =
      `${ctx.memoryText}\n\nResearch this topic and write a structured summary with headings: ${ctx.input}\n` +
      `Note where you are unsure instead of inventing specifics. This assistant cannot browse the live web; say so if live data would be needed.`;
    const text = await complete(
      ctx,
      "You are a careful research assistant. Structure your answer with headings. Never invent citations, dates or statistics.",
      prompt,
    );
    return {
      summary: `Researched "${ctx.input.slice(0, 80)}" (AI summary — verify facts before publishing).`,
      output: text,
      proposals: [
        {
          type: "create_post",
          summary: `Create draft post "${draftTitle(ctx.input)}" (research summary)`,
          risk: "low",
          payload: { title: draftTitle(ctx.input), content: text, status: "draft", type: "post" },
        },
      ],
    };
  },
};

export const supportResponder: AgentDefinition = {
  id: "support-responder",
  name: "Support Responder",
  description:
    "Drafts a reply to a visitor's message or comment. The reply is a draft for the admin to send — the agent never posts it itself.",
  capabilities: ["Draft replies to visitor messages", "Match the site's tone from memory"],
  risk: "low",
  requiresProvider: true,
  async run(ctx: AgentContext): Promise<AgentResult> {
    const prompt = `${ctx.memoryText}\n\nA visitor wrote:\n"${ctx.input}"\n\nDraft a polite, helpful reply. Do not promise anything the site cannot do (no refunds, no account changes) — say the admin will follow up where needed.`;
    const text = await complete(ctx, "You are a helpful support writer. Be polite, brief and honest.", prompt);
    return {
      summary: "Drafted a reply to the visitor's message (draft only — not sent).",
      output: text,
    };
  },
};

export const emailComposer: AgentDefinition = {
  id: "email-composer",
  name: "Email Composer",
  description:
    "Drafts an email (subject + body) on a topic you give it. Sending email arrives in Milestone 8 — this agent only drafts.",
  capabilities: ["Draft email subject + body", "Use website memory as context"],
  risk: "low",
  requiresProvider: true,
  async run(ctx: AgentContext): Promise<AgentResult> {
    const prompt = `${ctx.memoryText}\n\nDraft an email about: ${ctx.input}\nStart with a "Subject:" line, then the body. Keep it short.`;
    const text = await complete(ctx, "You are an email writer. Short subject, clear body, no hype.", prompt);
    return {
      summary: "Drafted an email (draft only — sending arrives in Milestone 8).",
      output: text,
    };
  },
};

export const socialComposer: AgentDefinition = {
  id: "social-composer",
  name: "Social Composer",
  description:
    "Drafts short social posts on a topic. Posting to social accounts arrives in Milestone 8 — this agent only drafts.",
  capabilities: ["Draft short social posts", "Keep posts within typical length limits"],
  risk: "low",
  requiresProvider: true,
  async run(ctx: AgentContext): Promise<AgentResult> {
    const prompt = `${ctx.memoryText}\n\nWrite 3 short social media posts about: ${ctx.input}\nNumber them 1-3. Keep each under 240 characters. No hashtags spam.`;
    const text = await complete(ctx, "You are a social media writer. Short, plain, useful posts.", prompt);
    return {
      summary: "Drafted 3 social posts (drafts only — publishing to social accounts arrives in Milestone 8).",
      output: text,
    };
  },
};
