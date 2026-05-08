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
 * Returns an empty info object (with warnings) if the file is missing or unparseable.
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
  if (!parsedToc) {
    warnings.push(`could not parse TOC from ${path} — proceeding with full export`);
    return { warnings, existingKeyTopics: null, existingContent: existing };
  }

  const existingKeyTopics =
    parseKeyTopicsFromMarkdown(existing) ??
    (templateText ? parseKeyTopicsFlatFromTemplate(existing, templateText) : null);

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

  // Regenerate
  try {
    const enriched = await enrichWithToc(parsed, enrichmentInput, format, claudePath, existing.existingToc);
    return { enriched, tocReused: false, tocRegenerated: true, warnings };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    warnings.push(`enrichment failed: ${msg}`);
    return { enriched: parsed, tocReused: false, tocRegenerated: false, warnings };
  }
}
