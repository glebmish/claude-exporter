/**
 * Filename template substitution.
 *
 * Used for chat note filenames and artifact filenames. Variable values are
 * expected to come pre-sanitized (using sanitizeConversationTitle for chat
 * titles, sanitizeFilename for artifact titles, etc.). This module handles
 * the {{name}} substitution and a final cleanup pass.
 *
 * Behavior:
 *  - Unknown variables are left literal in the result so typos surface.
 *  - Final cleanup replaces filesystem-unsafe characters and collapses
 *    runs of underscores; no length truncation.
 *  - An empty post-cleanup result yields "untitled".
 */

const VARIABLE_RE = /\{\{(\w+)\}\}/g;

function finalCleanup(s: string): string {
  return s
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

export function applyFilenameTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  const substituted = template.replace(VARIABLE_RE, (match, name) =>
    name in vars ? vars[name] : match,
  );
  const cleaned = finalCleanup(substituted);
  return cleaned || "untitled";
}

export const DEFAULT_CHAT_NAME_TEMPLATE = "{{created}}_{{title}}";
export const DEFAULT_ARTIFACT_NAME_TEMPLATE = "{{seqNum}}_{{title}}";
