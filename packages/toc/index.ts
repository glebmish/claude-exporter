import { query } from "@anthropic-ai/claude-agent-sdk";
import { EventEmitter } from "node:events";
import type { ConversationResult, EnrichmentInput } from "../converter/index.ts";
import type { RenderedMessage } from "../converter/types.ts";

// Electron compat: Obsidian's renderer process uses browser globals, so AbortSignal is a browser
// EventTarget, not a Node.js one. The Agent SDK calls EventEmitter.setMaxListeners(n, abortSignal)
// which throws "argument must be an instance of EventEmitter or EventTarget" in this environment.
// Wrapping the static method to swallow that error — the only consequence is no listener limit on
// internal SDK abort signals, which is harmless.
const _origSetMaxListeners = EventEmitter.setMaxListeners.bind(EventEmitter);
EventEmitter.setMaxListeners = (...args: unknown[]) => {
  try { _origSetMaxListeners(...(args as Parameters<typeof _origSetMaxListeners>)); } catch (_) { /* Electron AbortSignal compat */ }
};

export interface TocTopic {
  heading: string;  // section label — also used as the heading anchor
  range: string;    // "1–3" (human message 1-based indices, en-dash)
  recap: string;
}

export interface AgentTocEntry {
  timestamp: string;  // matches RenderedMessage.timestamp
  heading: string;    // 2–5 word section label
  recap: string;
}

/**
 * Convert a heading string to a GitHub-style anchor id.
 * e.g. "Human · Mar 23, 2026 2:45 PM" → "human-mar-23-2026-245-pm"
 */
export function headingToAnchor(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function formatMsgRange(range: string): string {
  const [start, end] = range.split("\u2013");
  return start === end ? `msg ${start}` : `msgs ${range}`;
}

/**
 * Render topics into a "## Table of Contents" block (links only, no recap).
 * Returns undefined when toc is empty.
 */
export function renderTocBlock(
  toc: TocTopic[],
  format: "standard" | "obsidian"
): string | undefined {
  if (toc.length === 0) return undefined;
  const lines = ["## Table of Contents", ""];
  for (const { heading, range } of toc) {
    const msgRange = formatMsgRange(range);
    if (format === "obsidian") {
      lines.push(`- [[#${heading} *(${msgRange})*]]`);
    } else {
      lines.push(`- [${heading} *(${msgRange})*](#${headingToAnchor(`${heading} (${msgRange})`)})`);
    }
  }
  return lines.join("\n");
}

/**
 * Render topics into a "## Table of Contents" block with recap sub-bullets.
 * Returns undefined when toc is empty.
 */
export function renderTocWithRecapBlock(
  toc: TocTopic[],
  format: "standard" | "obsidian"
): string | undefined {
  if (toc.length === 0) return undefined;
  const lines = ["## Table of Contents", ""];
  for (const { heading, range, recap } of toc) {
    const msgRange = formatMsgRange(range);
    if (format === "obsidian") {
      lines.push(`- [[#${heading} *(${msgRange})*]]`);
    } else {
      lines.push(`- [${heading} *(${msgRange})*](#${headingToAnchor(`${heading} (${msgRange})`)})`);
    }
    lines.push(`  - ${recap}`);
  }
  return lines.join("\n");
}

/**
 * Render keywords into a "## Key topics" block.
 * Returns undefined when keywords is empty.
 */
export function renderKeyTopicsBlock(keywords: string[]): string | undefined {
  if (keywords.length === 0) return undefined;
  const lines = ["## Key topics", ""];
  for (const kw of keywords) {
    lines.push(`- ${kw}`);
  }
  return lines.join("\n");
}

export function parseKeyTopicsFromMarkdown(markdown: string): string[] | null {
  const match = markdown.match(/## Key topics\n([\s\S]*?)(?=\n## |\n---|\n# |$)/);
  if (!match) return null;
  return match[1].split("\n").filter(l => l.startsWith("- ")).map(l => l.slice(2));
}

export function parseKeyTopicsFlatFromTemplate(markdown: string, templateText: string): string[] | null {
  const templateLine = templateText.split("\n").find(l => l.includes("{{keyTopicsFlat}}"));
  if (!templateLine) return null;
  const placeholder = "{{keyTopicsFlat}}";
  const idx = templateLine.indexOf(placeholder);
  const prefix = templateLine.slice(0, idx).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const suffix = templateLine.slice(idx + placeholder.length).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`^${prefix}(.+)${suffix}$`, "m"));
  if (!match) return null;
  return match[1].split(", ").map(s => s.trim()).filter(Boolean);
}

/**
 * Rebuild a ConversationResult with TOC fields from existing parsed topics,
 * without calling the AI model. Used when re-exporting with no new messages.
 */
export function reuseExistingToc(
  result: ConversationResult,
  existingToc: TocTopic[],
  format: "standard" | "obsidian",
  existingKeyTopics: string[] | null,
): ConversationResult {
  const entries = buildIncrementalEntries(result.messages, existingToc, []);
  applyTopicSections(result.messages, entries, result.messageCount);

  const toc = renderTocBlock(existingToc, format);
  const tocWithRecap = renderTocWithRecapBlock(existingToc, format);
  const keyTopics = existingKeyTopics !== null ? renderKeyTopicsBlock(existingKeyTopics) : undefined;
  const keyTopicsFlat = existingKeyTopics !== null && existingKeyTopics.length > 0 ? existingKeyTopics.join(", ") : undefined;

  return {
    ...result,
    ...(toc !== undefined ? { toc } : {}),
    ...(tocWithRecap !== undefined ? { tocWithRecap } : {}),
    ...(keyTopics !== undefined ? { keyTopics } : {}),
    ...(keyTopicsFlat !== undefined ? { keyTopicsFlat } : {}),
  };
}

/**
 * Parse structured TOC entries from a rendered markdown file.
 * Supports both obsidian ([[#Heading *(msgs N–M)*|Heading]]) and
 * standard ([Heading](#heading-msgs-n-m)) formats.
 * Returns null on any parse failure — callers should fall back to full regeneration.
 */
export function parseTocFromMarkdown(
  markdown: string,
): { topics: TocTopic[]; lastCoveredMsg: number } | null {
  // Find TOC section — stop at next ## heading, ---, or end
  const tocMatch = markdown.match(
    /## Table of Contents\n([\s\S]*?)(?=\n## |\n---|\n# |$)/,
  );
  if (!tocMatch) return null;

  const lines = tocMatch[1].split("\n");
  const topics: TocTopic[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Obsidian: - [[#Heading *(msgs N–M)*]] (new) or [[#Heading *(msgs N–M)*|Heading]] (old)
    const obsidian =
      line.match(/^- \[\[#(.+?) \*\(msgs? (\d+)(?:\u2013(\d+))?\)\*\]\]/) ||
      line.match(/^- \[\[#(.+?) \*\(msgs? (\d+)(?:\u2013(\d+))?\)\*\|/);
    if (obsidian) {
      const heading = obsidian[1];
      const start = parseInt(obsidian[2]);
      const end = obsidian[3] ? parseInt(obsidian[3]) : start;
      const range = `${start}\u2013${end}`;
      let recap = "";
      if (lines[i + 1]?.startsWith("  - ")) {
        recap = lines[i + 1].slice(4);
        i++;
      }
      topics.push({ heading, range, recap });
      i++;
      continue;
    }

    // Standard: - [Heading *(msgs N–M)*](#anchor) (new) or [Heading](#anchor-msgs-n-m) (old)
    const standard =
      line.match(/^- \[(.+?) \*\(msgs? (\d+)(?:\u2013(\d+))?\)\*\]\(/) ||
      line.match(/^- \[(.+?)\]\(#[^)]*-msgs?-(\d+)(?:-(\d+))?\)/);
    if (standard) {
      const heading = standard[1];
      const start = parseInt(standard[2]);
      const end = standard[3] ? parseInt(standard[3]) : start;
      const range = `${start}\u2013${end}`;
      let recap = "";
      if (lines[i + 1]?.startsWith("  - ")) {
        recap = lines[i + 1].slice(4);
        i++;
      }
      topics.push({ heading, range, recap });
      i++;
      continue;
    }

    // Skip empty lines; any non-empty non-bullet line means parse failure
    if (line.trim() !== "") return null;
    i++;
  }

  if (topics.length === 0) return null;

  const lastRange = topics[topics.length - 1].range;
  const lastEnd = parseInt(lastRange.split("\u2013")[1]);
  if (isNaN(lastEnd)) return null;

  return { topics, lastCoveredMsg: lastEnd };
}

const SYSTEM_PROMPT = `You are analyzing an exported Claude conversation. Produce a structured table of contents.

Conversation format: a JSON object with a "messages" array. Each message has a "role" ("human" or "assistant"), an optional "timestamp" (present on human messages only, e.g. "Mar 15, 2026, 1:02 PM"), and a "blocks" array containing content blocks of type "text", "tool_use", or "artifact".

Rules:
1. Identify topic shifts — only when the subject meaningfully changes, not for every message.
2. "timestamp": copy the exact "timestamp" value from the human message where the topic begins.
3. "heading": 2-5 word label for the topic that follows.
4. "recap": 2-3 sentences summarising what was asked and answered. Refer to the human as "you".
5. "keyTopics": flat list of short deduplicated subject keywords, condensed to no more than 10 topics.

Return a "toc" array of 1 if the conversation has no meaningful topic shifts.

Example input:
{
  "messages": [
    { "role": "human", "timestamp": "Mar 15, 2026, 1:02 PM", "blocks": [{ "type": "text", "text": "Let's discuss how cool Obsidian is" }] },
    { "role": "assistant", "blocks": [{ "type": "text", "text": "Yeah, it's very cool!" }] },
    { "role": "human", "timestamp": "Mar 15, 2026, 1:04 PM", "blocks": [{ "type": "text", "text": "Now explain the meaning of life" }] },
    { "role": "assistant", "blocks": [{ "type": "artifact", "name": "42 essay" }, { "type": "text", "text": "42" }] }
  ]
}

Example output:
{
  toc: [
    {
      timestamp: "Mar 15, 2026, 1:02 PM",
      heading: "Obsidian coolness",
      recap: "You claimed that Obsidian is cool and invited a discussion."
    },
    {
      timestamp: "Mar 15, 2026, 1:04 PM",
      heading: "Meaning of life",
      recap: "You asked Claude to explain the meaning of life and received 42 as an answer."
    }
  ],
  keyTopics: [
    "Obsidian",
    "Meaning of life"
  ]
}
`;

interface AgentOutput {
  toc: AgentTocEntry[];
  keyTopics: string[];
}

/**
 * Convert existing TocTopic[] into AgentTocEntry[] (recovering timestamps from messages)
 * and append new model-generated entries. Used by incremental TOC enrichment.
 * Entries whose start humanIndex has no matching message are silently dropped.
 */
export function buildIncrementalEntries(
  messages: RenderedMessage[],
  existingToc: TocTopic[],
  newEntries: AgentTocEntry[],
): AgentTocEntry[] {
  const humanMsgs = messages.filter(
    (m): m is RenderedMessage & { humanIndex: number; timestamp: string } =>
      m.role === "human" && m.humanIndex !== undefined && !!m.timestamp,
  );

  const recovered: AgentTocEntry[] = existingToc
    .map((topic) => {
      const startIdx = parseInt(topic.range.split("\u2013")[0]);
      const msg = humanMsgs.find((m) => m.humanIndex === startIdx);
      if (!msg) return null;
      return { timestamp: msg.timestamp, heading: topic.heading, recap: topic.recap };
    })
    .filter((e): e is AgentTocEntry => e !== null);

  return [...recovered, ...newEntries];
}

function buildIncrementalPrompt(existingToc: TocTopic[], input: EnrichmentInput): string {
  const lastRange = existingToc[existingToc.length - 1].range;
  const lastCoveredMsg = parseInt(lastRange.split("\u2013")[1]);

  return `You are updating the table of contents for an exported Claude conversation.

The existing TOC already covers messages 1 through ${lastCoveredMsg}. Your task is to handle any new messages (after msg ${lastCoveredMsg}).

Conversation format: a JSON object with a "messages" array. Each message has a "role" ("human" or "assistant"), an optional "timestamp" (present on human messages only), and a "blocks" array.

Rules:
1. "extendLastEntry": set true if the new messages continue the topic of the last existing entry, or if there are no new topic shifts. Set false only if the new messages start with a clearly distinct subject.
2. "newEntries": array of new TOC entries for genuinely new topics starting after msg ${lastCoveredMsg}. Use the same format as before (timestamp from the first human message of the topic, 2–5 word heading, 2–3 sentence recap referring to the human as "you"). Leave empty if all new messages belong to the last existing topic.
3. "keyTopics": regenerate the full keyword list for the entire conversation (including old and new messages), max 10 topics.

Existing TOC (covers msgs 1–${lastCoveredMsg}):
${JSON.stringify(existingToc, null, 2)}

Conversation (all messages):
${JSON.stringify(input, null, 2)}`;
}

/**
 * Enrich a ConversationResult with AI-generated toc, tocWithRecap, and keyTopics.
 * Single agent call generates all three; which appear in output depends on the consumer.
 * The format argument must match the format used in parseConversation.
 */
const tlog = {
  info:  (...a: unknown[]) => console.log( "[claude-exporter/toc]", ...a),
  warn:  (...a: unknown[]) => console.warn("[claude-exporter/toc]", ...a),
  error: (...a: unknown[]) => console.error("[claude-exporter/toc]", ...a),
};

export function applyTopicSections(
  messages: RenderedMessage[],
  topics: AgentTocEntry[],
  totalHumanMessages: number,
): void {
  const timestampToIndex = new Map<string, number>();
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === "human" && msg.timestamp) {
      timestampToIndex.set(msg.timestamp, i);
    }
  }

  const resolved: Array<{ msgIdx: number; humanIndex: number; entry: AgentTocEntry }> = [];
  for (const entry of topics) {
    const msgIdx = timestampToIndex.get(entry.timestamp);
    if (msgIdx === undefined) continue;
    const humanIndex = messages[msgIdx].humanIndex;
    if (humanIndex === undefined) continue;
    resolved.push({ msgIdx, humanIndex, entry });
  }

  resolved.sort((a, b) => a.msgIdx - b.msgIdx);

  for (let i = 0; i < resolved.length; i++) {
    const { msgIdx, humanIndex, entry } = resolved[i];
    const rangeEnd = i + 1 < resolved.length
      ? resolved[i + 1].humanIndex - 1
      : totalHumanMessages;
    messages[msgIdx].sectionHeading = entry.heading;
    messages[msgIdx].sectionRange = `${humanIndex}–${rangeEnd}`;
  }
}

export async function enrichWithToc(
  result: ConversationResult,
  input: EnrichmentInput,
  format: "standard" | "obsidian",
  claudePath?: string,
  existingToc?: TocTopic[],
): Promise<ConversationResult> {
  tlog.info(`Starting enrichment — format: ${format}, claudePath: ${claudePath ?? "(not set)"}, messages: ${input.messages.length}`);
  const isIncremental = existingToc !== undefined && existingToc.length > 0;
  tlog.info(`Mode: ${isIncremental ? "incremental" : "full"}`);

  let agentOutput: AgentOutput | undefined;
  let messageCount = 0;

  try {
    for await (const message of (query as any)({
      prompt: isIncremental
        ? buildIncrementalPrompt(existingToc!, input)
        : SYSTEM_PROMPT + "\n\nConversation:\n\n" + JSON.stringify(input, null, 2),
      options: {
        model: "claude-haiku-4-5",
        tools: [],
        mcpServers: {},
        maxTurns: 0,
        ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {}),
        outputFormat: {
          type: "json_schema",
          schema: isIncremental
            ? {
                type: "object",
                properties: {
                  extendLastEntry: { type: "boolean" },
                  newEntries: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        timestamp: { type: "string" },
                        heading:   { type: "string" },
                        recap:     { type: "string" },
                      },
                      required: ["timestamp", "heading", "recap"],
                      additionalProperties: false,
                    },
                  },
                  keyTopics: { type: "array", items: { type: "string" } },
                },
                required: ["extendLastEntry", "newEntries", "keyTopics"],
                additionalProperties: false,
              }
            : {
                type: "object",
                properties: {
                  toc: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        timestamp: { type: "string" },
                        heading:   { type: "string" },
                        recap:     { type: "string" },
                      },
                      required: ["timestamp", "heading", "recap"],
                      additionalProperties: false,
                    },
                  },
                  keyTopics: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
                required: ["toc", "keyTopics"],
                additionalProperties: false,
              },
        },
      },
    })) {
      messageCount++;
      const type = (message as any).type;
      const subtype = (message as any).subtype;
      tlog.info(`Agent message #${messageCount}: type=${type} subtype=${subtype ?? "-"} is_error=${(message as any).is_error ?? false}`);

      if ((message as any).is_error) {
        tlog.error(`Agent error message:`, JSON.stringify(message, null, 2));
      }

      if ("structured_output" in message && message.structured_output) {
        agentOutput = message.structured_output as AgentOutput;
        tlog.info(`structured_output received`);
      } else if (type === "result") {
        tlog.warn(`Result message has no structured_output — result text: "${String((message as any).result ?? "").slice(0, 200)}"`);
      }
    }
  } catch (err) {
    tlog.error(`Agent query threw:`, err);
    return result;
  }

  tlog.info(`Agent stream complete — ${messageCount} messages received, agentOutput: ${agentOutput ? "present" : "MISSING"}`);

  if (!agentOutput) {
    tlog.warn(`No structured_output found in any agent message — returning result unchanged`);
    return result;
  }

  let allEntries: AgentTocEntry[];
  let rawKeyTopics: string[];

  if (isIncremental) {
    const inc = agentOutput as { extendLastEntry: boolean; newEntries: AgentTocEntry[]; keyTopics: string[] };
    tlog.info(`Incremental output — extendLastEntry: ${inc.extendLastEntry} (informational; range computation is automatic), newEntries: ${inc.newEntries?.length ?? 0}`);
    allEntries = buildIncrementalEntries(result.messages, existingToc!, inc.newEntries ?? []);
    rawKeyTopics = inc.keyTopics ?? [];
  } else {
    const full = agentOutput as AgentOutput;
    allEntries = full.toc ?? [];
    rawKeyTopics = full.keyTopics ?? [];
  }

  tlog.info(`Entries resolved — total: ${allEntries.length}, keyTopics: ${rawKeyTopics.length}`);

  // Annotate messages with section headings/ranges
  applyTopicSections(result.messages, allEntries, result.messageCount);

  // Build TocTopic[] for rendering
  const tocTopics: TocTopic[] = allEntries
    .map(entry => {
      const msg = result.messages.find(m => m.role === "human" && m.timestamp === entry.timestamp);
      if (!msg?.sectionRange) return null;
      return { heading: entry.heading, range: msg.sectionRange, recap: entry.recap };
    })
    .filter((t): t is TocTopic => t !== null);

  const toc = renderTocBlock(tocTopics, format);
  const tocWithRecap = renderTocWithRecapBlock(tocTopics, format);
  const keyTopics = renderKeyTopicsBlock(rawKeyTopics);
  const keyTopicsFlat = rawKeyTopics.length > 0
    ? rawKeyTopics.join(", ")
    : undefined;

  tlog.info(`Rendered — toc: ${toc ? "yes" : "empty"}, tocWithRecap: ${tocWithRecap ? "yes" : "empty"}, keyTopicsFlat: ${keyTopicsFlat ?? "(none)"}`);

  return {
    ...result,
    ...(toc !== undefined ? { toc } : {}),
    ...(tocWithRecap !== undefined ? { tocWithRecap } : {}),
    ...(keyTopics !== undefined ? { keyTopics } : {}),
    ...(keyTopicsFlat !== undefined ? { keyTopicsFlat } : {}),
  };
}
