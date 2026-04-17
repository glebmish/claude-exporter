import type { ConversationResult } from "../../packages/converter/index.ts";
import { renderContent } from "../../packages/converter/index.ts";

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

  const substituted = templateText.replace(VARIABLE_RE, (match, name) => {
    return name in vars ? vars[name] : match;
  });

  if (!templateText.includes("{{content}}")) {
    return substituted + content;
  }

  return substituted;
}
