/**
 * Shared converter module — utility functions ported from obsidian-plugin/converter.mjs.
 * No browser dependencies; usable from Node CLI and test harnesses.
 */

import type { Message, MessageBlock, BuildMarkdownOptions, BuildMarkdownContext, BuildMarkdownResult, ConversationResult, RenderedMessage, ConversationData, Citation, EnrichmentInput, EnrichmentMessage, EnrichmentBlock, ImageMeta } from "./types.ts";
import { getFormatter } from "./formatters.ts";
import { applyFilenameTemplate, sanitizeForFilename, DEFAULT_CHAT_NAME_TEMPLATE } from "./filename-template.ts";

export * from "./types.ts";
export { getFormatter } from "./formatters.ts";
export { applyFilenameTemplate, sanitizeForFilename, DEFAULT_CHAT_NAME_TEMPLATE } from "./filename-template.ts";

// MIME type → file extension mapping
export const MIME_TO_EXT: Record<string, string> = {
  "text/markdown": ".md",
  "text/html": ".html",
  "text/javascript": ".js",
  "text/x-python": ".py",
  "application/x-python": ".py",
  "text/css": ".css",
  "text/plain": ".txt",
  "text/x-typescript": ".ts",
  "text/typescript": ".ts",
  "application/json": ".json",
  "text/x-ruby": ".rb",
  "text/x-go": ".go",
  "text/x-rust": ".rs",
  "text/x-java": ".java",
  "text/x-c": ".c",
  "text/x-cpp": ".cpp",
  "text/x-csharp": ".cs",
  "text/x-shell": ".sh",
  "text/x-sql": ".sql",
  "text/yaml": ".yaml",
  "text/xml": ".xml",
  "text/x-swift": ".swift",
  "text/x-kotlin": ".kt",
  "text/x-scala": ".scala",
  "text/x-php": ".php",
  "text/csv": ".csv",
  "image/svg+xml": ".svg",
  "application/vnd.ant.react": ".tsx",
};

export function getExtFromMime(mimeType: string): string {
  if (!mimeType) return ".txt";
  return MIME_TO_EXT[mimeType] || ".txt";
}

export function sanitizeFilename(title: string): string {
  return title
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .substring(0, 50);
}

/**
 * Workaround for the unofficial "Chat Archive" browser extension/plugin: when it
 * archives a chat it captures the sidebar row's textContent (which includes the
 * "Last message X ago" time-ago label) into the conversation `name` and appends
 * ` ^archived`. Result: `<title>Last message N <unit> ago ^archived`. This is
 * NOT a Claude.ai bug — it is data damage caused by the third-party plugin and
 * it is permanent in stored chat names. We strip both markers so exported notes
 * have clean titles.
 */
export function stripArchivePluginMarkers(name: string): string {
  return name
    .replace(/\s*\^archived$/i, "")
    .replace(/Last message .*$/i, "")
    .trimEnd();
}

export function sanitizeConversationTitle(name: string | null): string {
  if (!name || name === "New conversation") return "claude_conversation";
  return stripArchivePluginMarkers(name)
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .substring(0, 100);
}

export function formatTimestamp(isoString: string): string | null {
  if (!isoString) return null;
  return new Date(isoString).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDatePrefix(isoString: string): string {
  if (!isoString) return "";
  return isoString.substring(0, 10); // YYYY-MM-DD
}

export function formatModelName(model: string): string {
  if (!model || model === "unknown") return "";
  const m = model.toLowerCase();
  const families = ["opus", "sonnet", "haiku"];
  for (const fam of families) {
    const idx = m.indexOf(fam);
    if (idx === -1) continue;
    const name = fam.charAt(0).toUpperCase() + fam.slice(1);
    // Check for digits before family name first: "claude-3-5-sonnet"
    const before = m.slice(0, idx).replace(/-$/, "");
    const preDigits = before.match(/(\d+)[-.]?(\d+)?$/);
    if (preDigits) {
      return `${name} ${preDigits[1]}${preDigits[2] ? "." + preDigits[2] : ""}`;
    }
    // Extract version digits after the family name (skip date-like suffixes)
    const after = m.slice(idx + fam.length).replace(/^-/, "");
    const digits = after.match(/^(\d{1,2})[-.]?(\d{1,2})?/);
    if (digits) {
      return `${name} ${digits[1]}${digits[2] ? "." + digits[2] : ""}`;
    }
    return name;
  }
  return model;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function toolCallSummary(name: string, input: Record<string, unknown>): string {
  if (name === "conversation_search") {
    return `conversation_search: "${(input.query as string) || "?"}"`;
  }
  if (name === "web_search") {
    return `web_search: "${(input.query as string) || "?"}"`;
  }
  if (name === "web_fetch") {
    return `web_fetch: ${(input.url as string) || "?"}`;
  }
  if (name === "launch_extended_search_task") {
    const cmd = ((input.command as string) || "?").substring(0, 80);
    return `deep_research: "${cmd}"`;
  }
  // Compact single-line summary for any other tool
  const parts: string[] = [];
  for (const [k, v] of Object.entries(input || {})) {
    if (typeof v === "string" && v) {
      parts.push(`${k}="${v.substring(0, 50)}"`);
    } else if (Array.isArray(v)) {
      parts.push(`${k}=[${v.length}]`);
    }
  }
  if (parts.length > 0) {
    const summary = parts.join(", ");
    return summary.length > 100 ? `${name}: ${summary.substring(0, 100)}…` : `${name}: ${summary}`;
  }
  return name;
}

export function toolResultSummary(block: MessageBlock): string {
  if (block.is_error) return "error";
  const content = block.content;
  if (Array.isArray(content) && content.length > 0) {
    const text = content[0]?.text || "";
    if (text === "OK" || text === "ok") return "ok";
    const truncated = text.length <= 40 ? text : `${text.substring(0, 40)}...`;
    return truncated;
  }
  if (block.display_content?.content) {
    const count = block.display_content.content.length;
    return `${count} results`;
  }
  return "ok";
}

/**
 * Replayed research artifact — reconstructed from `artifacts` tool_use blocks
 * in the conversation. The body is sourced from `input.content` of the `create`
 * block; subsequent `update` / `rewrite` commands are intentionally NOT applied
 * (only `create` is supported today — see `replayResearchArtifacts`).
 */
export interface ResearchArtifact {
  id: string;
  title: string;
  /** MIME type from `input.type` (e.g. "text/markdown"). */
  mimeType: string;
  content: string;
}

/**
 * Walk the conversation's `artifacts` tool_use blocks and collect the body of
 * each `command="create"` block. Wiggle's sandbox listing does not include
 * research artifacts (they're rendered Claude-side, not stored as files), so
 * the conversation API is the only source — the artifact's full markdown body
 * lives in the create block's `input.content`.
 *
 * Only `create` is handled today; `update` and `rewrite` (and any other future
 * command) are reported via the warnings channel and otherwise ignored, so the
 * caller can surface that something was lost. In current data only `create`
 * occurs for research artifacts; updates/rewrites historically appeared on the
 * canvas/code artifact tool, not on `compass_artifact_wf-…` research outputs.
 */
export function replayResearchArtifacts(
  messages: Message[],
): { artifacts: ResearchArtifact[]; warnings: string[] } {
  const artifacts: ResearchArtifact[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const msg of messages) {
    if (msg.sender !== "assistant") continue;
    for (const block of msg.content || []) {
      if (block.type !== "tool_use" || block.name !== "artifacts") continue;
      const input = block.input || {};
      const id = typeof input.id === "string" ? input.id : "";
      if (!id) continue;
      const command = typeof input.command === "string" ? input.command : "";
      if (command === "create") {
        if (seen.has(id)) {
          warnings.push(`research artifact ${id}: duplicate "create" command — keeping first`);
          continue;
        }
        seen.add(id);
        artifacts.push({
          id,
          title: typeof input.title === "string" && input.title ? input.title : "untitled",
          mimeType: typeof input.type === "string" && input.type ? input.type : "text/plain",
          content: typeof input.content === "string" ? input.content : "",
        });
      } else if (command === "update" || command === "rewrite") {
        warnings.push(`research artifact ${id}: "${command}" command not supported — patch ignored, exported body reflects the original "create" only`);
      } else {
        warnings.push(`research artifact ${id}: unknown command "${command}" ignored`);
      }
    }
  }
  return { artifacts, warnings };
}

export function collectImages(messages: Message[]): ImageMeta[] {
  const images: ImageMeta[] = [];
  for (let i = 0; i < messages.length; i++) {
    for (const file of messages[i].files || []) {
      if (file.file_kind === "image" && (file.preview_url || file.preview_asset?.url)) {
        images.push({
          msgIndex: i,
          fileName: file.file_name || `image_${file.file_uuid || "unknown"}.png`,
          url: (file.preview_asset?.url || file.preview_url) as string,
        });
      }
    }
  }
  return images;
}

export function parseConversationId(urlOrId: string): string | null {
  const UUID_RE = /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/;
  const normalized = urlOrId.toLowerCase().trim();
  if (normalized.includes("/")) {
    if (!normalized.includes("claude.ai")) return null;
    const match = normalized.match(UUID_RE);
    return match?.[0] || null;
  }
  if (!UUID_RE.test(normalized)) return null;
  return normalized;
}

/** Tracks unique citation URLs and assigns sequential reference numbers. */
export class CitationTracker {
  private urlToIndex = new Map<string, number>();
  private entries: Array<{ index: number; title: string; url: string }> = [];

  /** Register a citation and return its 1-based reference number. */
  add(url: string, title?: string): number {
    const existing = this.urlToIndex.get(url);
    if (existing !== undefined) return existing;
    const idx = this.entries.length + 1;
    this.urlToIndex.set(url, idx);
    this.entries.push({ index: idx, title: title || url, url });
    return idx;
  }

  /** Render the collected links as a markdown section. */
  renderLinksSection(): string | null {
    if (this.entries.length === 0) return null;
    const lines = ["## Links", ""];
    for (const e of this.entries) {
      lines.push(`${e.index}. [${e.title}](${e.url})`);
    }
    return lines.join("\n");
  }
}

/**
 * Insert inline reference numbers into text based on citation ranges.
 * First registers all citations in document order (by start_index) to get
 * stable reference numbers, then inserts markers from end to start so that
 * insertions don't shift earlier indices.
 */
export function insertCitationLinks(
  text: string,
  citations: Citation[],
  tracker: CitationTracker,
): string {
  if (!citations || citations.length === 0) return text;

  const valid = citations.filter(c => c.url && c.end_index != null);
  if (valid.length === 0) return text;

  // Register in document order (by start_index) so numbers are sequential
  const byStart = [...valid].sort((a, b) => a.start_index - b.start_index);
  const refNums = new Map<Citation, number>();
  for (const cit of byStart) {
    refNums.set(cit, tracker.add(cit.url, cit.title));
  }

  // Insert from end to start so indices stay valid
  const byEndDesc = [...valid].sort((a, b) => b.end_index - a.end_index);
  let result = text;
  const insertedAt = new Set<number>();

  for (const cit of byEndDesc) {
    const pos = cit.end_index;
    if (insertedAt.has(pos)) continue;
    insertedAt.add(pos);

    const refNum = refNums.get(cit)!;
    const marker = ` [${refNum}](${cit.url})`;
    result = result.slice(0, pos) + marker + result.slice(pos);
  }

  return result;
}

export function renderContent(messages: RenderedMessage[], linksSection?: string): string {
  const parts: string[] = [];

  for (const msg of messages) {
    const lines: string[] = [];
    lines.push("---");
    lines.push("");

    if (msg.sectionHeading !== undefined) {
      const fmtRange = (r: string) => { const [a, b] = r.split("\u2013"); return a === b ? `msg ${a}` : `msgs ${r}`; };
      const range = msg.sectionRange ? ` *(${fmtRange(msg.sectionRange)})*` : "";
      lines.push(`## ${msg.sectionHeading}${range}`);
      lines.push("");
    }

    lines.push(msg.header);
    lines.push("");

    if (msg.body) {
      lines.push(msg.body);
    }

    parts.push(lines.join("\n"));
  }

  let content = parts.join("\n\n");

  if (linksSection) {
    content += "\n\n---\n\n" + linksSection;
  }

  return content.trimEnd();
}

export function buildEnrichmentInput(data: ConversationData): EnrichmentInput {
  const messages: EnrichmentMessage[] = [];

  for (const msg of data.chat_messages || []) {
    if (msg.sender !== "human" && msg.sender !== "assistant") continue;

    const blocks: EnrichmentBlock[] = [];

    if (msg.sender === "human") {
      for (const block of msg.content || []) {
        if (block.type === "text" && block.text?.trim()) {
          blocks.push({ type: "text", text: block.text.trim() });
        }
      }
      const timestamp = formatTimestamp(msg.created_at);
      messages.push({ role: "human", ...(timestamp ? { timestamp } : {}), blocks });
    } else {
      for (const block of msg.content || []) {
        if (block.type === "text" && block.text?.trim()) {
          blocks.push({ type: "text", text: block.text.trim() });
        } else if (block.type === "tool_use" && block.name === "artifacts") {
          const title = (block.input?.title as string) || "untitled";
          blocks.push({ type: "artifact", name: title });
        } else if (block.type === "tool_use" && block.name && block.name !== "artifacts" && block.name !== "present_files") {
          blocks.push({ type: "tool_use", name: block.name, summary: toolCallSummary(block.name, block.input || {}) });
        }
      }
      messages.push({ role: "assistant", blocks });
    }
  }

  return { messages };
}

export function parseConversation(
  data: ConversationData,
  options: BuildMarkdownOptions,
  context: BuildMarkdownContext = {},
): ConversationResult {
  const { conversationId, imageFilenames } = context;
  const userName = "You";
  const fmt = getFormatter(options.format || "standard");
  const isObsidian = options.format === "obsidian";

  const rawMessages = data.chat_messages || [];
  const title = stripArchivePluginMarkers(data.name || "Claude Conversation") || "Claude Conversation";
  const model = data.model || "unknown";
  const chatTitleMinimal = sanitizeForFilename(title);
  const chatTitleSanitized = sanitizeConversationTitle(data.name);
  const chatCreatedDate = formatDatePrefix(data.created_at);
  const chatNameTemplate = context.chatNameTemplate ?? DEFAULT_CHAT_NAME_TEMPLATE;
  // Map sandbox-file paths to their basename so tool_use callouts can link to files.
  const sandboxFiles = options.includeArtifacts !== false ? (context.sandboxFiles ?? []) : [];
  type SandboxEntry = { filename: string; relativeWritePath: string };
  const sandboxFileByPath = new Map<string, SandboxEntry>();
  // Wiggle lists files under /mnt/user-data/outputs/, but Claude's tool calls increasingly
  // reference the same files via their sandbox-shell path (/home/claude/...). Index by
  // basename so we still link the wikilink when only the directory differs.
  const sandboxFileByBasename = new Map<string, SandboxEntry>();
  // Replayed research artifacts are linked by their `compass_artifact_wf-…` id —
  // the `artifacts` tool_use block has an id but no path/filepaths to match on.
  const sandboxFileByArtifactId = new Map<string, SandboxEntry>();
  for (const f of sandboxFiles) {
    const entry = { filename: f.filename, relativeWritePath: f.relativeWritePath };
    sandboxFileByPath.set(f.path, entry);
    const idx = f.path.lastIndexOf("/");
    const base = idx === -1 ? f.path : f.path.slice(idx + 1);
    if (!sandboxFileByBasename.has(base)) sandboxFileByBasename.set(base, entry);
    if (f.artifactId) sandboxFileByArtifactId.set(f.artifactId, entry);
  }
  const lookupSandboxFile = (p: string): SandboxEntry | undefined => {
    const direct = sandboxFileByPath.get(p);
    if (direct) return direct;
    const idx = p.lastIndexOf("/");
    const base = idx === -1 ? p : p.slice(idx + 1);
    return sandboxFileByBasename.get(base);
  };

  let humanCount = 0;
  for (const msg of rawMessages) {
    if (msg.sender === "human") humanCount++;
  }

  // Compute datedTitle early so the attachment link prefix can be derived from it
  const exportedDate = new Date().toISOString().substring(0, 10);
  const datedTitle = context.chatName
    ? (sanitizeForFilename(context.chatName) || "untitled")
    : applyFilenameTemplate(chatNameTemplate, {
        title: chatTitleMinimal,
        titleSanitized: chatTitleSanitized,
        created: chatCreatedDate,
        updated: formatDatePrefix(data.updated_at),
        exported: exportedDate,
        model: formatModelName(model),
        messages: String(humanCount),
        artifacts: String(sandboxFiles.length),
      });

  // Standard format renders <prefix>/<filename> as a relative path from the note.
  // Default prefix is datedTitle: when the orchestrator co-locates attachments with the note,
  // files live at <outputDir>/<datedTitle>/<filename> and the note at <outputDir>/<datedTitle>.md.
  // Obsidian formatter ignores the prefix and emits basename-only wikilinks.
  const attachmentLinkPrefix = context.attachmentLinkPrefix ?? datedTitle;

  const chatUrl = `https://claude.ai/chat/${data.uuid || conversationId || "unknown"}`;
  const citationTracker = new CitationTracker();
  const renderedMessages: RenderedMessage[] = [];
  let humanIndex = 0;

  for (let i = 0; i < rawMessages.length; i++) {
    const msg = rawMessages[i];
    if (msg.sender !== "human" && msg.sender !== "assistant") continue;

    const bodyLines: string[] = [];

    if (msg.sender === "human") {
      humanIndex++;
      const ts = formatTimestamp(msg.created_at);
      const header = ts ? `### ${userName} · ${ts}` : `### ${userName}`;

      const msgImages = (imageFilenames || []).filter(img => img.msgIndex === i);
      for (const img of msgImages) {
        bodyLines.push(fmt.imageLink(img.filename, attachmentLinkPrefix));
        bodyLines.push("");
      }

      for (const att of msg.attachments || []) {
        const name = att.file_name || "pasted content";
        const size = att.file_size ? ` (${formatFileSize(att.file_size)})` : "";
        bodyLines.push(`*[Attached: ${name}${size}]*`);
        bodyLines.push("");
        if (att.extracted_content) {
          const lang = att.file_type && att.file_type !== "txt" ? att.file_type : "";
          const longest = att.extracted_content.match(/`{3,}/g)?.reduce((m, s) => Math.max(m, s.length), 0) ?? 0;
          const fence = "`".repeat(Math.max(3, longest + 1));
          bodyLines.push(fence + lang);
          bodyLines.push(att.extracted_content.replace(/\n+$/, ""));
          bodyLines.push(fence);
          bodyLines.push("");
        }
      }

      for (const block of msg.content || []) {
        if (block.type === "text" && block.text?.trim()) {
          let text = block.text;
          if (block.citations?.length) {
            text = insertCitationLinks(text, block.citations, citationTracker);
          }
          bodyLines.push(text.trim());
          bodyLines.push("");
        }
      }

      renderedMessages.push({
        role: "human",
        timestamp: ts ?? undefined,
        humanIndex,
        header,
        body: bodyLines.join("\n").trimEnd(),
      });
    } else if (msg.sender === "assistant") {
      const header = `### Claude ${formatModelName(model)}`;
      const blocks = msg.content || [];

      if (options.includeThinking) {
        const thinkingParts: string[] = [];
        for (const block of blocks) {
          if (block.type === "thinking") {
            const text = block.thinking || "";
            if (text.trim()) thinkingParts.push(text.trim());
          }
        }
        if (thinkingParts.length > 0) {
          bodyLines.push(fmt.thinkingBlock(thinkingParts));
          bodyLines.push("");
        }
      }

      let toolCalls: string[] = [];
      // Sandbox files touched by tool_use blocks in this message (insertion order, deduped
      // by on-disk relativeWritePath so a single file referenced via multiple sandbox paths
      // — e.g. /home/claude/foo.md by create_file and /mnt/user-data/outputs/foo.md by
      // present_files — links exactly once at the end of the assistant message body.
      const linkedFiles: SandboxEntry[] = [];
      const linkedSeen = new Set<string>();
      const linkPath = (p: string | undefined): void => {
        if (!p) return;
        const entry = lookupSandboxFile(p);
        if (!entry || linkedSeen.has(entry.relativeWritePath)) return;
        linkedSeen.add(entry.relativeWritePath);
        linkedFiles.push(entry);
      };

      const flushToolCalls = () => {
        if (toolCalls.length === 0) return;
        bodyLines.push(fmt.toolUseBlock(toolCalls));
        bodyLines.push("");
        toolCalls = [];
      };

      for (const block of blocks) {
        if (block.type === "thinking") {
          continue;
        } else if (block.type === "text" && block.text?.trim()) {
          if (isObsidian) flushToolCalls();
          let text = block.text;
          if (block.citations?.length) {
            text = insertCitationLinks(text, block.citations, citationTracker);
          }
          bodyLines.push(text.trim());
          bodyLines.push("");
        } else if (block.type === "tool_use" && options.includeToolCalls) {
          // Every tool_use is rendered as a callout entry — never replayed.
          toolCalls.push(toolCallSummary(block.name!, block.input || {}));
          // Collect any file paths the tool touched so we can link them.
          const input = block.input || {};
          if (typeof input.path === "string") linkPath(input.path);
          if (Array.isArray(input.filepaths)) {
            for (const fp of input.filepaths) {
              if (typeof fp === "string") linkPath(fp);
            }
          }
          // Research artifacts (the `artifacts` tool) have no path/filepaths in
          // their input, only an id — link via the replay-populated id index.
          if (block.name === "artifacts" && typeof input.id === "string") {
            const entry = sandboxFileByArtifactId.get(input.id);
            if (entry && !linkedSeen.has(entry.relativeWritePath)) {
              linkedSeen.add(entry.relativeWritePath);
              linkedFiles.push(entry);
            }
          }
        } else if (block.type === "tool_result" && options.includeToolCalls) {
          if (toolCalls.length > 0) {
            const summary = toolResultSummary(block);
            toolCalls[toolCalls.length - 1] += ` → ${summary}`;
          }
        }
      }

      flushToolCalls();

      // Emit one wikilink per unique file the tool_use blocks touched, at the end of the message.
      // The standard formatter resolves the link URL via `<prefix>/<relativeWritePath>` so uploads
      // (which sit at `<datedTitle>/uploads/foo.png`) point at the right on-disk location;
      // the obsidian formatter ignores the prefix and resolves by basename.
      if (options.includeArtifacts !== false) {
        for (const entry of linkedFiles) {
          bodyLines.push(fmt.artifactLink(entry.relativeWritePath, entry.filename, attachmentLinkPrefix));
          bodyLines.push("");
        }
      }

      renderedMessages.push({
        role: "assistant",
        header,
        body: bodyLines.join("\n").trimEnd(),
      });
    }
  }

  const linksSection = citationTracker.renderLinksSection() ?? undefined;

  return {
    title,
    url: chatUrl,
    model,
    created: formatDatePrefix(data.created_at),
    updated: formatDatePrefix(data.updated_at),
    exported: exportedDate,
    createdTimestamp: formatTimestamp(data.created_at) ?? formatDatePrefix(data.created_at),
    updatedTimestamp: formatTimestamp(data.updated_at) ?? formatDatePrefix(data.updated_at),
    messageCount: humanCount,
    artifacts: sandboxFiles.length,
    messages: renderedMessages,
    ...(linksSection ? { linksSection } : {}),
    datedTitle,
  };
}

export function renderDefault(result: ConversationResult): string {
  const lines: string[] = [];

  lines.push("---");
  lines.push(`title: "${result.title.replace(/"/g, '\\"')}"`);
  lines.push(`source: ${result.url}`);
  lines.push(`model: ${result.model}`);
  lines.push(`created: ${result.created}`);
  lines.push(`updated: ${result.updated}`);
  lines.push(`exported: ${result.exported}`);
  lines.push(`messages: ${result.messageCount}`);
  if (result.artifacts > 0) {
    lines.push(`artifacts: ${result.artifacts}`);
  }
  lines.push("---");
  lines.push("");
  lines.push(`# ${result.title}`);
  lines.push("");
  lines.push(`- **Date**: ${result.createdTimestamp} → ${result.updatedTimestamp}`);
  lines.push(`- **Model**: ${result.model}`);
  lines.push(`- **Messages**: ${result.messageCount}`);
  lines.push("");

  if (result.toc) {
    lines.push(result.toc);
    lines.push("");
  }

  if (result.tocWithRecap) {
    lines.push(result.tocWithRecap);
    lines.push("");
  }

  if (result.keyTopics) {
    lines.push(result.keyTopics);
    lines.push("");
  }

  lines.push(renderContent(result.messages, result.linksSection));

  return lines.join("\n").trimEnd() + "\n";
}

export function buildMarkdown(
  data: ConversationData,
  options: BuildMarkdownOptions,
  context: BuildMarkdownContext = {},
): BuildMarkdownResult {
  const result = parseConversation(data, options, context);
  return {
    markdown: renderDefault(result),
    datedTitle: result.datedTitle,
  };
}
