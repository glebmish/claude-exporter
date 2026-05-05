export interface Citation {
  title?: string;
  url: string;
  start_index: number;
  end_index: number;
}

export interface MessageBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: Array<{ text?: string }>;
  is_error?: boolean;
  display_content?: { content: unknown[] };
  citations?: Citation[];
}

export interface Message {
  uuid: string;
  sender: "human" | "assistant";
  content: MessageBlock[];
  created_at: string;
  attachments?: Array<{ file_name?: string; file_size?: number }>;
  files?: Array<{
    file_uuid?: string;
    file_kind?: string;
    file_name?: string;
    preview_url?: string;
    preview_asset?: { url?: string };
  }>;
}

export interface ConversationData {
  uuid: string;
  name: string;
  model: string;
  created_at: string;
  updated_at: string;
  chat_messages: Message[];
}

export interface BuildMarkdownOptions {
  format?: "standard" | "obsidian";
  includeArtifacts?: boolean;
  includeThinking?: boolean;
  includeToolCalls?: boolean;
}

export interface BuildMarkdownContext {
  conversationId?: string;
  /** Pre-computed link prefix for artifacts (e.g. "attachments/2026-01-15_my_chat"). If absent, derived from artifactsFolder + datedTitle when artifactsFolder is set. */
  artifactLinkPrefix?: string;
  imageLinkPrefix?: string;
  imageFilenames?: Array<{ msgIndex: number; filename: string }>;
  chatNameTemplate?: string;
  artifactNameTemplate?: string;
  /** When set, parseConversation derives artifactLinkPrefix as `${artifactsFolder}/${datedTitle}`. */
  artifactsFolder?: string;
}

export interface ArtifactFile {
  filename: string;
  content: string;
  title: string;
  type: string;
  seqNum: number;
}

export interface RenderedMessage {
  role: "human" | "assistant";
  timestamp?: string;       // human only — "Mar 15, 2026, 1:02 PM" — used for TOC timestamp matching
  humanIndex?: number;      // 1-based count among human messages — used for section ranges
  header: string;           // e.g. "### You · Mar 15, 2026, 1:02 PM" or "### Claude Sonnet 4.6"
  body: string;             // rendered body — no leading/trailing newlines
  sectionHeading?: string;  // set by enrichWithToc — section label text
  sectionRange?: string;    // set by enrichWithToc — e.g. "1–3" (human message 1-based indices)
}

export interface ConversationResult {
  title: string;
  url: string;
  model: string;
  created: string;
  updated: string;
  exported: string;
  createdTimestamp: string;
  updatedTimestamp: string;
  messageCount: number;       // human messages only
  artifacts: number;
  messages: RenderedMessage[];
  linksSection?: string;      // rendered "## Links\n\n1. [title](url)" block, or undefined
  toc?: string;
  tocWithRecap?: string;
  keyTopics?: string;
  keyTopicsFlat?: string;
  artifactFiles: ArtifactFile[];
  datedTitle: string;
}

export interface BuildMarkdownResult {
  markdown: string;
  artifactFiles: ArtifactFile[];
  datedTitle: string;
}

export interface ImageMeta {
  msgIndex: number;
  fileName: string;
  url: string;
}

export interface EnrichmentBlock {
  type: "text" | "tool_use" | "artifact";
  text?: string;
  name?: string;
  summary?: string;
}

export interface EnrichmentMessage {
  role: "human" | "assistant";
  timestamp?: string;
  blocks: EnrichmentBlock[];
}

export interface EnrichmentInput {
  messages: EnrichmentMessage[];
}

export interface Formatter {
  imageLink(filename: string, prefix: string | undefined): string;
  artifactLink(filename: string, title: string, prefix: string | undefined): string;
  thinkingBlock(parts: string[]): string;
  toolUseBlock(calls: string[]): string;
}
