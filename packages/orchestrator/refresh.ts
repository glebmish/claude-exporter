import type { FileSystem } from "./types.ts";
import type { ConversationResult, EnrichmentInput } from "../converter/index.ts";
import {
  parseTocFromMarkdown,
  parseKeyTopicsFromMarkdown,
  parseKeyTopicsFlatFromTemplate,
  reuseExistingToc,
  enrichWithToc,
} from "../toc/index.ts";
import type { TocTopic } from "../toc/index.ts";
import { findExportedKey, patchInProgress } from "./template.ts";

export interface ExistingFileInfo {
  existingToc?: TocTopic[];
  previousMessageCount?: number;
  existingKeyTopics: string[] | null;
  existingContent?: string;
  warnings: string[];
}

/**
 * Read and parse an existing exported markdown file.
 *
 * Renders that came from a template using only `{{keyTopicsFlat}}` (no `{{toc}}`
 * or `{{tocWithRecap}}`) won't have a `## Table of Contents` section in the
 * file — the agent ran during export, but only the topics field got
 * substituted in. Try the template-aware key-topics parser AND the body
 * `- **Messages**: N` line as fallbacks so we can still reuse enrichment for
 * those files instead of regenerating on every refresh.
 */
export async function loadExistingFile(
  fs: FileSystem,
  path: string,
  templateText?: string,
): Promise<ExistingFileInfo> {
  const warnings: string[] = [];
  const existing = await fs.readText(path);
  if (existing === null) {
    warnings.push(`existing file not found at ${path} — proceeding with full export`);
    return { warnings, existingKeyTopics: null };
  }

  const parsedToc = parseTocFromMarkdown(existing);
  const existingKeyTopics =
    parseKeyTopicsFromMarkdown(existing) ??
    (templateText ? parseKeyTopicsFlatFromTemplate(existing, templateText) : null);
  // Body line emitted by both default and templated renders: `- **Messages**: 53`.
  const messagesMatch = existing.match(/^-\s+\*\*Messages\*\*:\s*(\d+)\b/m);
  const messageCountFromBody = messagesMatch ? parseInt(messagesMatch[1], 10) : undefined;

  if (!parsedToc) {
    if (existingKeyTopics === null && messageCountFromBody === undefined) {
      warnings.push(`could not parse TOC, key topics, or message count from ${path} — proceeding with full export`);
    }
    return {
      existingKeyTopics,
      ...(messageCountFromBody !== undefined ? { previousMessageCount: messageCountFromBody } : {}),
      existingContent: existing,
      warnings,
    };
  }

  return {
    existingToc: parsedToc.topics,
    previousMessageCount: parsedToc.lastCoveredMsg,
    existingKeyTopics,
    existingContent: existing,
    warnings,
  };
}

/**
 * Patch the in-progress marker on an existing file.
 * Derives the {{exported}}-bound key from the template, falling back to "exported".
 */
export async function applyInProgressPatch(
  fs: FileSystem,
  path: string,
  existingContent: string,
  templateText: string | undefined,
): Promise<void> {
  const key = (templateText ? findExportedKey(templateText) : null) ?? "exported";
  const patched = patchInProgress(existingContent, key);
  if (patched !== existingContent) {
    await fs.writeText(path, patched);
  }
}

export interface EnrichmentDecision {
  enriched: ConversationResult;
  tocReused: boolean;
  tocRegenerated: boolean;
  warnings: string[];
}

export interface TemplateVarPresence {
  hasToc: boolean;
  hasTocWithRecap: boolean;
  hasKeyTopics: boolean;
  hasKeyTopicsFlat: boolean;
}

export interface EnrichmentFlags {
  toc: boolean;
  tocRecap: boolean;
  topics: boolean;
}

export async function decideEnrichment(
  parsed: ConversationResult,
  enrichmentInput: EnrichmentInput,
  format: "standard" | "obsidian",
  claudePath: string | undefined,
  flags: EnrichmentFlags,
  templateVars: TemplateVarPresence,
  existing: ExistingFileInfo,
  onStatus?: (msg: string) => void,
): Promise<EnrichmentDecision> {
  const wantsAny = flags.toc || flags.tocRecap || flags.topics;
  if (!wantsAny) {
    return { enriched: parsed, tocReused: false, tocRegenerated: false, warnings: [] };
  }

  const warnings: string[] = [];
  const tocAvailable = existing.existingToc !== undefined && existing.previousMessageCount !== undefined;
  const tocUpToDate = tocAvailable && (existing.previousMessageCount as number) >= parsed.messageCount;

  if (tocAvailable && tocUpToDate) {
    const keyTopicVarsPresent = templateVars.hasKeyTopics || templateVars.hasKeyTopicsFlat || flags.topics;
    const recapVarsPresent = templateVars.hasTocWithRecap || flags.tocRecap;
    const keyTopicsRecoverable = !keyTopicVarsPresent || existing.existingKeyTopics !== null;
    const recapRecoverable = !recapVarsPresent || (existing.existingToc as TocTopic[]).some(t => t.recap !== "");

    if (keyTopicsRecoverable && recapRecoverable) {
      const enriched = reuseExistingToc(parsed, existing.existingToc as TocTopic[], format, existing.existingKeyTopics);
      return { enriched, tocReused: true, tocRegenerated: false, warnings };
    }
  }

  // Topics-only fast path: when the user's template renders just `{{keyTopics}}`
  // / `{{keyTopicsFlat}}` (no `{{toc}}` and no `{{tocWithRecap}}`), the file
  // never carries a `## Table of Contents` section so `tocAvailable` is false
  // — but the topics list is right there in the body and we don't need TOC
  // structure to satisfy the template. Avoid the agent call.
  const wantsToc = flags.toc || templateVars.hasToc;
  const wantsTocRecap = flags.tocRecap || templateVars.hasTocWithRecap;
  const onlyTopics = !wantsToc && !wantsTocRecap;
  const topicsUpToDate =
    existing.previousMessageCount !== undefined &&
    existing.previousMessageCount >= parsed.messageCount;
  if (onlyTopics && topicsUpToDate && existing.existingKeyTopics !== null) {
    const topicsLine = existing.existingKeyTopics.join(", ");
    const enriched: ConversationResult = {
      ...parsed,
      keyTopics: existing.existingKeyTopics.map((t) => `- ${t}`).join("\n"),
      keyTopicsFlat: topicsLine,
    };
    return { enriched, tocReused: true, tocRegenerated: false, warnings };
  }

  // Regenerate
  try {
    onStatus?.("Generating table of contents...");
    const enriched = await enrichWithToc(parsed, enrichmentInput, format, claudePath, existing.existingToc);
    return { enriched, tocReused: false, tocRegenerated: true, warnings };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    warnings.push(`enrichment failed: ${msg}`);
    return { enriched: parsed, tocReused: false, tocRegenerated: false, warnings };
  }
}
