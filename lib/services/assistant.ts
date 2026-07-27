// Lucy's assistant — a conversational layer over the sourcing data.
//
// She types plain English ("house schemes in Croydon with planning, up to 9
// units", "which top leads still need a contact?", "draft an approach for the
// Greenwich 9-unit site") and Claude answers using the tools below, which run
// real queries and the safe additive actions against the live database.
//
// Deliberate boundary: the assistant can READ everything and do ADDITIVE work
// (find a contact, draft an approach). It cannot send emails or delete anything
// — sending stays Lucy's manual click on the Sourcing page. No destructive tools
// are exposed here on purpose.
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db/client";
import { withRetry } from "@/lib/retry";
import { findAgentContact, draftApproach } from "@/lib/services/contact-finder";
import { getRoiSnapshot } from "@/lib/services/roi";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_ROUNDS = 6;

export function isClaudeConfigured(): boolean {
  const key = process.env.ANTHROPIC_API_KEY;
  return !!(key && !key.includes("PLACEHOLDER"));
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const SYSTEM_PROMPT = `You are the IdealLand sourcing assistant, helping Lucy James work the property-sourcing pipeline.

IdealLand finds small residential development sites (1-9 units) in London from planning applications, works out the agent who filed each one, and approaches them to ask whether the owner would sell — IdealLand is the retained buyer's agent and earns a sourcing fee. Never suggest pitching a site straight to a developer.

How to help:
- Use the tools to answer with REAL data. Never invent numbers, addresses, or leads — if a tool returns nothing, say so plainly.
- When Lucy describes what she wants ("houses in Croydon with planning up to 9 units"), translate it into a search_leads call with the right filters.
- Keep answers short and scannable. Use simple bullet lists — NEVER markdown tables (they render as raw pipes in the chat). One lead per line: address — borough — N units — score — planning status — (ref). Mention the reference so she can find it on the Sourcing page.
- "with planning" / "with pp" means an application that has been decided; remind her to confirm on the council page whether it was granted vs refused, since we don't store that.
- Planning data has no asking price, so you cannot confirm any site fits a budget — say that if asked about price.

What you can DO for her:
- find_contact: track down the agent for a specific lead.
- draft_approach: write the seller-approach email (in Lucy's own template) for a lead.
After drafting, tell her it's ready on the Sourcing page to review and send.

What you must NOT claim to do: you cannot send emails and cannot delete anything. Sending is always Lucy's own click on the Sourcing page. If she asks you to send, explain that and point her to the lead.

Be warm, brief, and practical.`;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_leads",
    description:
      "Search planning-application leads with filters. Returns matching leads plus a total count. Use for any 'show me / find / how many / which leads' request.",
    input_schema: {
      type: "object",
      properties: {
        borough: { type: "string", description: "Borough/council name, e.g. 'Croydon', 'Greenwich', 'Lewisham'. Case-insensitive substring." },
        minUnits: { type: "number", description: "Minimum residential units (1-9)." },
        maxUnits: { type: "number", description: "Maximum residential units (1-9)." },
        planningStatus: { type: "string", enum: ["with_permission", "seeking", "any"], description: "with_permission = decided application; seeking = live/undecided." },
        schemeType: { type: "string", enum: ["house", "flat", "any"], description: "house = house/dwelling schemes (flats excluded); flat = flats/apartments." },
        minScore: { type: "number", description: "Minimum AI lead score, 1-10." },
        contactStatus: { type: "string", enum: ["found", "none", "any"], description: "found = an agent contact has been discovered; none = not yet researched." },
        approachStatus: { type: "string", enum: ["drafted", "sent", "none", "any"], description: "Whether an approach email has been drafted/sent." },
        keyword: { type: "string", description: "Free-text keyword to match in the address or scheme description." },
        limit: { type: "number", description: "Max rows to return (default 12, max 25)." },
      },
      required: [],
    },
  },
  {
    name: "get_overview",
    description: "Get pipeline totals and the ROI snapshot (leads sourced, prime leads, contacts found, approaches drafted/sent, money saved). Use for 'how am I doing / summary / ROI / how many packs' questions.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_lead_detail",
    description: "Get full detail for one lead by its reference or id, including the AI brief, agent contact, and any drafted approach email.",
    input_schema: {
      type: "object",
      properties: { reference: { type: "string", description: "The lead's planning reference or id." } },
      required: ["reference"],
    },
  },
  {
    name: "find_contact",
    description: "Find the agent (architect/planning consultant) and their contact details for a specific lead. Additive action. Give the lead's reference or id.",
    input_schema: {
      type: "object",
      properties: { reference: { type: "string", description: "The lead's planning reference or id." } },
      required: ["reference"],
    },
  },
  {
    name: "draft_approach",
    description: "Draft the seller-approach email for a specific lead, in Lucy's template. Additive action — it appears on the Sourcing page for her to review and send. Give the lead's reference or id.",
    input_schema: {
      type: "object",
      properties: { reference: { type: "string", description: "The lead's planning reference or id." } },
      required: ["reference"],
    },
  },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

async function resolveLead(reference: string) {
  const ref = reference.trim();
  return prisma.planningApplication.findFirst({
    where: { OR: [{ id: ref }, { reference: ref }, { reference: { contains: ref } }] },
  });
}

async function runTool(name: string, input: Json): Promise<Json> {
  switch (name) {
    case "search_leads": {
      const where: Json = {};
      const and: Json[] = [];
      if (input.borough) where.council = { contains: String(input.borough) };
      const units: Json = {};
      if (typeof input.minUnits === "number") units.gte = input.minUnits;
      if (typeof input.maxUnits === "number") units.lte = input.maxUnits;
      if (Object.keys(units).length) where.units = units;
      if (input.planningStatus === "with_permission") where.status = "decided";
      else if (input.planningStatus === "seeking") where.status = "submitted";
      if (typeof input.minScore === "number") where.leadScore = { gte: input.minScore };
      if (input.contactStatus === "found") where.contactStatus = "found";
      else if (input.contactStatus === "none") where.contactStatus = null;
      if (input.approachStatus === "drafted") where.approachStatus = "drafted";
      else if (input.approachStatus === "sent") where.approachStatus = "sent";
      else if (input.approachStatus === "none") where.approachStatus = null;
      if (input.schemeType === "house") {
        and.push({ OR: [{ description: { contains: "house" } }, { description: { contains: "dwelling" } }] });
        and.push({ NOT: { description: { contains: "flat" } } });
        and.push({ NOT: { description: { contains: "apartment" } } });
      } else if (input.schemeType === "flat") {
        and.push({ OR: [{ description: { contains: "flat" } }, { description: { contains: "apartment" } }] });
      }
      if (input.keyword) {
        and.push({ OR: [{ address: { contains: String(input.keyword) } }, { description: { contains: String(input.keyword) } }] });
      }
      if (and.length) where.AND = and;

      const limit = Math.min(Math.max(Number(input.limit) || 12, 1), 25);
      const [total, rows] = await Promise.all([
        prisma.planningApplication.count({ where }),
        prisma.planningApplication.findMany({
          where,
          orderBy: [{ leadScore: "desc" }, { submittedAt: "desc" }],
          take: limit,
          select: {
            reference: true, council: true, address: true, units: true, leadScore: true,
            status: true, contactStatus: true, agentFirm: true, agentEmail: true,
            approachStatus: true, councilUrl: true,
          },
        }),
      ]);
      return {
        total,
        showing: rows.length,
        leads: rows.map((r) => ({
          reference: r.reference,
          borough: r.council,
          address: r.address,
          units: r.units,
          score: r.leadScore,
          planning: r.status === "decided" ? "with permission (verify granted/refused)" : "seeking",
          contact: r.contactStatus === "found" ? `${r.agentFirm ?? "found"}${r.agentEmail ? ` <${r.agentEmail}>` : ""}` : "not yet found",
          approach: r.approachStatus ?? "none",
          councilPage: r.councilUrl ?? null,
        })),
      };
    }

    case "get_overview": {
      const roi = await getRoiSnapshot();
      return {
        leadsSourced: roi.funnel.leadsSourced,
        primeLeads: roi.funnel.primeLeads,
        contactsFound: roi.funnel.contactsFound,
        approachesDrafted: roi.funnel.approachesDrafted,
        approachesSent: roi.funnel.approachesSent,
        moneySavedPerMonth: roi.hard.netMonthly,
        moneySavedPerYear: roi.hard.netAnnual,
      };
    }

    case "get_lead_detail": {
      const lead = await resolveLead(String(input.reference));
      if (!lead) return { found: false, note: "No lead matches that reference." };
      return {
        found: true,
        reference: lead.reference,
        borough: lead.council,
        address: lead.address,
        units: lead.units,
        score: lead.leadScore,
        scoreReason: lead.leadScoreReason,
        brief: lead.intelligenceSummary,
        planning: lead.status === "decided" ? "with permission (verify granted/refused)" : "seeking",
        scheme: lead.description,
        councilPage: lead.councilUrl,
        agent: lead.contactStatus === "found"
          ? { name: lead.agentName, firm: lead.agentFirm, email: lead.agentEmail, phone: lead.agentPhone, website: lead.agentWebsite }
          : "not yet found",
        approach: lead.approachStatus
          ? { status: lead.approachStatus, subject: lead.approachSubject }
          : "not drafted",
      };
    }

    case "find_contact": {
      const lead = await resolveLead(String(input.reference));
      if (!lead) return { ok: false, note: "No lead matches that reference." };
      // Already researched: report the stored contact rather than re-running.
      if (lead.contactStatus === "found") {
        return {
          ok: true, found: true,
          agent: { name: lead.agentName, firm: lead.agentFirm, email: lead.agentEmail, phone: lead.agentPhone },
          note: "Contact already on file for this lead.",
        };
      }
      const r = await findAgentContact(lead.id, { force: false });
      if (!r.ok) return { ok: false, note: r.reason ?? "Contact search failed." };
      return {
        ok: true,
        found: r.result?.found ?? false,
        agent: r.result?.found
          ? { name: r.result.agentName, firm: r.result.agentFirm, email: r.result.agentEmail, phone: r.result.agentPhone }
          : null,
        note: r.result?.found ? "Agent found and saved to the lead." : (r.result?.notes ?? "Could not resolve the agent — check the council page for the last mile."),
      };
    }

    case "draft_approach": {
      const lead = await resolveLead(String(input.reference));
      if (!lead) return { ok: false, note: "No lead matches that reference." };
      const r = await draftApproach(lead.id, { force: true });
      if (!r.ok) return { ok: false, note: r.reason ?? "Draft failed." };
      return { ok: true, subject: r.subject, note: "Draft ready on the Sourcing page for Lucy to review and send." };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

export async function runAssistant(
  history: ChatMessage[]
): Promise<{ ok: boolean; reply?: string; reason?: string }> {
  if (!isClaudeConfigured()) return { ok: false, reason: "The assistant isn't configured (missing AI key)." };

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const messages: Anthropic.MessageParam[] = history
    .filter((m) => m.content?.trim())
    .map((m) => ({ role: m.role, content: m.content }));

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await withRetry(() =>
      client.messages.create({
        model: MODEL,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages,
      })
    );

    if (res.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: res.content });
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of res.content) {
        if (block.type !== "tool_use") continue;
        let out: Json;
        try {
          out = await runTool(block.name, (block.input ?? {}) as Json);
        } catch (err) {
          out = { error: err instanceof Error ? err.message : "tool failed" };
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(out),
        });
      }
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return { ok: true, reply: text || "…" };
  }

  return { ok: false, reason: "The assistant took too many steps — try rephrasing." };
}
