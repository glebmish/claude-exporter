/**
 * Filename template substitution.
 *
 * Used for chat note filenames and artifact filenames. Two title variants are
 * exposed in the variable map:
 *
 *   {{title}}, {{chatTitle}}                 — minimally sanitized (case + spaces preserved)
 *   {{titleSanitized}}, {{chatTitleSanitized}} — heavily sanitized (lowercased, underscored, length-capped)
 *
 * The substitution helper itself only:
 *   - replaces {{name}} tokens from the variable map (unknown vars left literal)
 *   - runs a minimal final cleanup: strip filesystem-unsafe chars, normalize
 *     whitespace, trim
 *   - falls back to "untitled" if the cleaned result is empty
 *
 * Length capping and case/underscore normalization happen earlier (when the
 * caller pre-sanitizes the values), not here.
 */

const VARIABLE_RE = /\{\{(\w+)\}\}/g;
// eslint-disable-next-line no-control-regex -- intentional: strip filesystem-illegal control bytes
const UNSAFE_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

// Common typographic Unicode characters get folded to ASCII so filenames stay
// shell- and cross-platform-friendly without losing legible content. Other
// non-ASCII characters (e.g. Cyrillic, CJK) pass through untouched.
const TYPOGRAPHIC_FOLD: Record<string, string> = {
  "—": "-",   // em dash
  "–": "-",   // en dash
  "→": "-",   // rightwards arrow
  "←": "-",   // leftwards arrow
  "…": "...", // horizontal ellipsis
  "“": '"',   // left double quote
  "”": '"',   // right double quote
  "‘": "'",   // left single quote
  "’": "'",   // right single quote / smart apostrophe
};

function foldTypography(s: string): string {
  let out = s;
  for (const [k, v] of Object.entries(TYPOGRAPHIC_FOLD)) {
    if (out.includes(k)) out = out.split(k).join(v);
  }
  return out;
}

export function sanitizeForFilename(s: string): string {
  return foldTypography(s)
    .replace(UNSAFE_CHARS, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function applyFilenameTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  const substituted = template.replace(VARIABLE_RE, (match, name) =>
    name in vars ? vars[name] : match,
  );
  const cleaned = sanitizeForFilename(substituted);
  return cleaned || "untitled";
}

export const DEFAULT_CHAT_NAME_TEMPLATE = "{{created}} {{title}}";
export const DEFAULT_ARTIFACT_NAME_TEMPLATE = "{{seqNum}} {{title}}";
