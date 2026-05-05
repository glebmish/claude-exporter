/**
 * Shared converter module — utility functions ported from obsidian-plugin/converter.mjs.
 * No browser dependencies; usable from Node CLI and test harnesses.
 */

import type { Message, MessageBlock, BuildMarkdownOptions, BuildMarkdownContext, BuildMarkdownResult, ConversationResult, RenderedMessage, ArtifactFile, ConversationData, Citation, EnrichmentInput, EnrichmentMessage, EnrichmentBlock, ImageMeta } from "./types.ts";
import { getFormatter } from "./formatters.ts";
import { applyFilenameTemplate, DEFAULT_CHAT_NAME_TEMPLATE, DEFAULT_ARTIFACT_NAME_TEMPLATE } from "./filename-template.ts";

export * from "./types.ts";
export { getFormatter } from "./formatters.ts";
export { applyFilenameTemplate, DEFAULT_CHAT_NAME_TEMPLATE, DEFAULT_ARTIFACT_NAME_TEMPLATE } from "./filename-template.ts";

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

// Reverse mapping: file extension → MIME type (for create_file artifacts)
const EXT_TO_MIME: Record<string, string> = {};
for (const [mime, ext] of Object.entries(MIME_TO_EXT)) {
  // First entry wins (e.g. text/x-python beats application/x-python for .py)
  if (!EXT_TO_MIME[ext]) EXT_TO_MIME[ext] = mime;
}

export function getExtFromMime(mimeType: string): string {
  if (!mimeType) return ".txt";
  return MIME_TO_EXT[mimeType] || ".txt";
}

function getMimeFromPath(filePath: string): string {
  const ext = "." + (filePath.match(/\.([^.]+)$/)?.[1] || "txt");
  return EXT_TO_MIME[ext] || "text/plain";
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

export function sanitizeConversationTitle(name: string | null): string {
  if (!name || name === "New conversation") return "claude_conversation";
  return name
    .replace(/\s*\^archived$/i, "")
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

export interface ArtifactInternal {
  title: string;
  type: string;
  content: string;
  seqNum: number;
  filename?: string;
  citations?: Citation[];
}

export interface ProcessedArtifacts {
  artifacts: Map<string, ArtifactInternal & { filename: string }>;
  /** Maps create_file paths → artifact IDs for linking in message rendering */
  pathToArtifactId: Map<string, string>;
}

/** Extract first markdown heading from content, or null */
function extractFirstHeading(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || null;
}

export function processArtifacts(
  messages: Message[],
  artifactNameTemplate: string = DEFAULT_ARTIFACT_NAME_TEMPLATE,
  chatVars: { chatTitle: string; chatCreated: string } = { chatTitle: "", chatCreated: "" },
): ProcessedArtifacts {
  const artifacts = new Map<string, ArtifactInternal>();
  const pathToArtifactId = new Map<string, string>();
  let seqNum = 0;

  for (const msg of messages) {
    if (msg.sender !== "assistant") continue;
    for (const block of msg.content || []) {
      if (block.type !== "tool_use") continue;
      const input = block.input || {};

      if (block.name === "artifacts") {
        const id = input.id as string;
        if (!id) continue;

        if (input.command === "create") {
          seqNum++;
          artifacts.set(id, {
            title: (input.title as string) || "untitled",
            type: (input.type as string) || "text/plain",
            content: (input.content as string) || "",
            seqNum,
            citations: (input.md_citations as Citation[] | undefined),
          });
        } else if (input.command === "update") {
          const existing = artifacts.get(id);
          if (existing && input.old_str && input.new_str !== undefined) {
            existing.content = existing.content.replace(
              input.old_str as string,
              input.new_str as string
            );
          }
        }
      } else if (block.name === "create_file") {
        const filePath = input.path as string;
        const fileText = input.file_text as string;
        if (!filePath || !fileText) continue;

        // Try to match with an existing artifact by first heading
        const heading = extractFirstHeading(fileText);
        let replaced = false;
        if (heading) {
          const headingLower = heading.toLowerCase();
          for (const [id, art] of artifacts) {
            const titleLower = art.title.toLowerCase();
            if (titleLower === headingLower ||
                headingLower.includes(titleLower) ||
                titleLower.includes(headingLower)) {
              art.content = fileText;
              pathToArtifactId.set(filePath, id);
              replaced = true;
              break;
            }
          }
        }

        if (!replaced) {
          seqNum++;
          const basename = filePath.split("/").pop()?.replace(/\.[^.]+$/, "") || "untitled";
          const title = heading || basename.replace(/[-_]/g, " ");
          const id = `file:${filePath}`;
          artifacts.set(id, {
            title,
            type: getMimeFromPath(filePath),
            content: fileText,
            seqNum,
          });
          pathToArtifactId.set(filePath, id);
        }
      }
    }
  }

  const result = new Map<string, ArtifactInternal & { filename: string }>();
  for (const [id, art] of artifacts) {
    const ext = getExtFromMime(art.type);
    const base = applyFilenameTemplate(artifactNameTemplate, {
      seqNum: String(art.seqNum).padStart(2, "0"),
      title: sanitizeFilename(art.title),
      chatTitle: chatVars.chatTitle,
      chatCreated: chatVars.chatCreated,
    });
    const filename = `${base}${ext}`;
    result.set(id, { ...art, filename });
  }
  return { artifacts: result, pathToArtifactId };
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
  const title = (data.name || "Claude Conversation").replace(/\s*\^archived$/i, "");
  const model = data.model || "unknown";
  const chatTitleSanitized = sanitizeConversationTitle(data.name);
  const chatCreatedDate = formatDatePrefix(data.created_at);
  const artifactNameTemplate = context.artifactNameTemplate ?? DEFAULT_ARTIFACT_NAME_TEMPLATE;
  const chatNameTemplate = context.chatNameTemplate ?? DEFAULT_CHAT_NAME_TEMPLATE;
  const processed = options.includeArtifacts !== false
    ? processArtifacts(rawMessages, artifactNameTemplate, { chatTitle: chatTitleSanitized, chatCreated: chatCreatedDate })
    : { artifacts: new Map<string, ArtifactInternal & { filename: string }>(), pathToArtifactId: new Map<string, string>() };
  const artifacts = processed.artifacts;
  const pathToArtifactId = processed.pathToArtifactId;

  let humanCount = 0;
  for (const msg of rawMessages) {
    if (msg.sender === "human") humanCount++;
  }

  // Compute datedTitle early so artifactLinkPrefix can be derived from it
  const exportedDate = new Date().toISOString().substring(0, 10);
  const datedTitle = applyFilenameTemplate(chatNameTemplate, {
    title: chatTitleSanitized,
    created: chatCreatedDate,
    updated: formatDatePrefix(data.updated_at),
    exported: exportedDate,
    model: formatModelName(model),
    messages: String(humanCount),
    artifacts: String(artifacts.size),
  });

  // Derive artifactLinkPrefix from artifactsFolder if caller didn't provide one explicitly
  const artifactLinkPrefix = context.artifactLinkPrefix
    ?? (context.artifactsFolder ? `${context.artifactsFolder}/${datedTitle}` : undefined);
  const imageLinkPrefix = context.imageLinkPrefix
    ?? ((imageFilenames && imageFilenames.length > 0) ? artifactLinkPrefix : undefined);

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
        bodyLines.push(fmt.imageLink(img.filename, imageLinkPrefix));
        bodyLines.push("");
      }

      for (const att of msg.attachments || []) {
        const name = att.file_name || "pasted content";
        const size = att.file_size ? ` (${formatFileSize(att.file_size)})` : "";
        bodyLines.push(`*[Attached: ${name}${size}]*`);
        bodyLines.push("");
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
        } else if (block.type === "tool_use" && block.name === "artifacts" && options.includeArtifacts !== false) {
          if (isObsidian) flushToolCalls();
          const id = block.input?.id as string;
          const art = artifacts.get(id);
          if (art) {
            bodyLines.push(fmt.artifactLink(art.filename, art.title, artifactLinkPrefix));
            bodyLines.push("");
          }
        } else if (block.type === "tool_use" && block.name === "present_files" && options.includeArtifacts !== false) {
          const filepaths = (block.input?.filepaths as string[]) || [];
          let anyLinked = false;
          for (const fp of filepaths) {
            const artId = pathToArtifactId.get(fp);
            const art = artId ? artifacts.get(artId) : undefined;
            if (art) {
              if (isObsidian) flushToolCalls();
              bodyLines.push(fmt.artifactLink(art.filename, art.title, artifactLinkPrefix));
              bodyLines.push("");
              anyLinked = true;
            }
          }
          if (!anyLinked && options.includeToolCalls) {
            toolCalls.push(toolCallSummary(block.name!, block.input || {}));
          }
        } else if (block.type === "tool_use" && block.name !== "artifacts" && options.includeToolCalls) {
          toolCalls.push(toolCallSummary(block.name!, block.input || {}));
        } else if (block.type === "tool_result" && options.includeToolCalls) {
          if (toolCalls.length > 0) {
            const summary = toolResultSummary(block);
            toolCalls[toolCalls.length - 1] += ` → ${summary}`;
          }
        }
      }

      flushToolCalls();

      renderedMessages.push({
        role: "assistant",
        header,
        body: bodyLines.join("\n").trimEnd(),
      });
    }
  }

  const linksSection = citationTracker.renderLinksSection() ?? undefined;

  const artifactFiles: ArtifactFile[] = [];
  for (const art of artifacts.values()) {
    let content = art.content;
    if (art.citations?.length) {
      const artTracker = new CitationTracker();
      content = insertCitationLinks(content, art.citations, artTracker);
      const artLinks = artTracker.renderLinksSection();
      if (artLinks) content = content.trimEnd() + "\n\n---\n\n" + artLinks + "\n";
    }
    artifactFiles.push({ filename: art.filename, content, title: art.title, type: art.type, seqNum: art.seqNum });
  }

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
    artifacts: artifacts.size,
    messages: renderedMessages,
    ...(linksSection ? { linksSection } : {}),
    artifactFiles,
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
    artifactFiles: result.artifactFiles,
    datedTitle: result.datedTitle,
  };
}
