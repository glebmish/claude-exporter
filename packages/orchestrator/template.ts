import type { ConversationResult } from "../converter/index.ts";
import { renderContent } from "../converter/index.ts";

const VARIABLE_RE = /\{\{(\w+)\}\}/g;

function buildHeader(result: ConversationResult): string {
  return [
    `# ${result.title}`,
    "",
    `- **Date**: ${result.createdTimestamp} → ${result.updatedTimestamp}`,
    `- **Model**: ${result.model}`,
    `- **Messages**: ${result.messageCount}`,
  ].join("\n");
}

export function applyTemplate(templateText: string, result: ConversationResult): string {
  const content = renderContent(result.messages, result.linksSection);

  const vars: Record<string, string> = {
    title: result.title,
    url: result.url,
    model: result.model,
    created: result.created,
    updated: result.updated,
    exported: result.exported,
    createdTimestamp: result.createdTimestamp,
    updatedTimestamp: result.updatedTimestamp,
    messages: String(result.messageCount),
    artifacts: String(result.artifacts),
    header: buildHeader(result),
    content,
    toc: result.toc ?? "",
    tocWithRecap: result.tocWithRecap ?? "",
    keyTopics: result.keyTopics ?? "",
    keyTopicsFlat: result.keyTopicsFlat ?? "",
  };

  const substituted = templateText.replace(VARIABLE_RE, (match, name) =>
    name in vars ? vars[name] : match,
  );

  if (!templateText.includes("{{content}}")) {
    const sep = substituted.endsWith("\n") ? "" : "\n";
    return substituted + sep + content;
  }
  return substituted;
}

/**
 * Scan a template body for a frontmatter line that uses {{exported}}.
 * Returns the YAML key name or null if not found.
 */
export function findExportedKey(templateText: string): string | null {
  const match = templateText.match(/^([\w-]+):\s*[^\n]*\{\{exported\}\}/m);
  return match ? match[1] : null;
}

/**
 * Replace the value of a frontmatter key with "updating".
 * Only modifies the first YAML frontmatter block.
 */
export function patchInProgress(content: string, key: string): string {
  return content.replace(
    /^(---\n[\s\S]*?\n---)/m,
    (frontmatter) =>
      frontmatter.replace(
        new RegExp(`^(${key}:\\s*)([^\\n]*)`, "m"),
        "$1updating",
      ),
  );
}
