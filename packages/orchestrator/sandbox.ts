/**
 * Fetches the conversation's live sandbox files from the wiggle store and
 * decodes them to text or binary. The wiggle store is the source of truth for
 * filesystem-backed artifacts (anything written via create_file, etc.).
 *
 * Research artifacts (the `artifacts` tool with `compass_artifact_wf-…` IDs)
 * are NOT stored as wiggle files — they're rendered Claude-side. Their bodies
 * live in the conversation API (`tool_use.input.content` on the create block)
 * and are replayed by the converter; this module exposes a helper to wrap a
 * `ResearchArtifact` as a `SandboxFileContent` so phase 8 writes them next to
 * wiggle artifacts and the converter links them with the same machinery.
 */

import type { CdpFacade } from "./types.ts";
import {
  applyFilenameTemplate,
  sanitizeForFilename,
  DEFAULT_ARTIFACT_NAME_TEMPLATE,
} from "../converter/filename-template.ts";
import { getExtFromMime } from "../converter/index.ts";
import type { ResearchArtifact } from "../converter/index.ts";

export type SandboxFileKind = "artifact" | "upload";

export interface SandboxFileNamingContext {
  artifactNameTemplate?: string;
  chatTitle: string;
  chatTitleSanitized: string;
  chatCreated: string;
}

export interface SandboxFileContent {
  /** Full sandbox path, e.g. `/mnt/user-data/outputs/02-shape.md`. For replayed
   * research artifacts (which have no real sandbox path) this is a synthetic
   * `research-artifact:<id>` placeholder used only to keep entries unique. */
  path: string;
  /** Basename (with extension), used both as on-disk filename and wikilink target */
  filename: string;
  /** Path relative to the per-chat attachments dir (e.g. `02-shape.md` or `uploads/IMG_8047.png`) */
  relativeWritePath: string;
  contentType: string;
  isBinary: boolean;
  /** Present iff !isBinary */
  text?: string;
  /** Present iff isBinary */
  binary?: ArrayBuffer;
  createdAt: string;
  /** 1-based, ordered by createdAt across the whole sandbox */
  seqNum: number;
  kind: SandboxFileKind;
  /** Set for replayed research artifacts; matches `tool_use.input.id` so the
   * converter can emit a wikilink without needing a path on the tool block. */
  artifactId?: string;
}

const TEXT_PREFIXES = ["text/", "application/json", "application/xml", "application/javascript"];

function isTextContentType(ct: string): boolean {
  const lower = (ct || "").toLowerCase();
  return TEXT_PREFIXES.some((p) => lower.startsWith(p));
}

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

export function sanitizeUploadBasename(name: string): string {
  const cleaned = sanitizeForFilename(name)
    .replace(/\.\.+/g, ".")
    .replace(/[\\/]/g, "");
  return cleaned || "upload";
}

function splitExt(name: string): { stem: string; ext: string } {
  const i = name.lastIndexOf(".");
  if (i <= 0) return { stem: name, ext: "" };
  return { stem: name.slice(0, i), ext: name.slice(i) };
}

function extractFirstHeading(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || null;
}

function classifyKind(path: string): SandboxFileKind {
  return path.startsWith("/mnt/user-data/uploads/") ? "upload" : "artifact";
}

function relativeWritePathFor(kind: SandboxFileKind, name: string): string {
  return kind === "upload" ? `uploads/${name}` : name;
}

/** Compute the on-disk filename via the user's artifact-name template. */
function computeFilename(
  rawName: string,
  text: string | undefined,
  seqNum: number,
  ctx: SandboxFileNamingContext,
): string {
  const template = ctx.artifactNameTemplate ?? DEFAULT_ARTIFACT_NAME_TEMPLATE;
  const { stem, ext } = splitExt(rawName);
  // Title comes from the first H1 for text files (matches what users see in claude.ai's UI),
  // falling back to the basename's stem with -/_ replaced by spaces.
  const heading = text ? extractFirstHeading(text) : null;
  const fallback = stem.replace(/[-_]+/g, " ").trim() || stem;
  const title = heading ?? fallback;
  const base = applyFilenameTemplate(template, {
    seqNum: String(seqNum).padStart(2, "0"),
    title: sanitizeForFilename(title),
    titleSanitized: sanitizeForFilename(title).toLowerCase().replace(/\s+/g, "_").slice(0, 50),
    chatTitle: ctx.chatTitle,
    chatTitleSanitized: ctx.chatTitleSanitized,
    chatCreated: ctx.chatCreated,
  });
  return `${base}${ext}`;
}

// Tolerant of charset / encoding parameters between the MIME type and the
// `;base64,` marker (e.g. `data:text/plain;charset=utf-8;base64,...`).
const DATA_URL_RE = /^data:[^,]*;base64,(.*)$/s;

function decodeDataUrlText(dataUrl: string): string | null {
  const m = dataUrl.match(DATA_URL_RE);
  if (!m) return null;
  return Buffer.from(m[1], "base64").toString("utf8");
}

function decodeDataUrlBinary(dataUrl: string): ArrayBuffer | null {
  const m = dataUrl.match(DATA_URL_RE);
  if (!m) return null;
  const buf = Buffer.from(m[1], "base64");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

export async function fetchSandboxFiles(
  cdp: Pick<CdpFacade, "listSandboxFiles" | "downloadSandboxFile">,
  conversationId: string,
  naming: SandboxFileNamingContext,
  opts: { onStatus?: (msg: string) => void; signal?: AbortSignal } = {},
): Promise<{ files: SandboxFileContent[]; warnings: string[] }> {
  if (opts.signal?.aborted) throw new Error("Cancelled");
  opts.onStatus?.("Listing sandbox files...");
  const list = await cdp.listSandboxFiles(conversationId);
  const metadata = list.files_metadata ?? [];
  const warnings: string[] = [];

  // Stable order: createdAt ascending. Ties resolved by path so seqNum is deterministic.
  const ordered = [...metadata].sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.path < b.path ? -1 : 1;
  });

  const result: SandboxFileContent[] = [];
  let seqNum = 0;

  for (const meta of ordered) {
    if (opts.signal?.aborted) throw new Error("Cancelled");
    seqNum++;
    opts.onStatus?.(`Downloading ${basename(meta.path)} (${seqNum}/${ordered.length})...`);

    const payload = await cdp.downloadSandboxFile(conversationId, meta.path);
    if (!payload) {
      warnings.push(`sandbox file ${meta.path} no longer available (skipped)`);
      continue;
    }

    const kind = classifyKind(meta.path);
    const rawName = basename(meta.path);
    const contentType = payload.contentType || meta.content_type || "application/octet-stream";
    const isBinary = !isTextContentType(contentType);

    let text: string | undefined;
    let binary: ArrayBuffer | undefined;
    if (isBinary) {
      const buf = decodeDataUrlBinary(payload.dataUrl);
      if (!buf) {
        warnings.push(`sandbox file ${meta.path} returned malformed payload (skipped)`);
        continue;
      }
      binary = buf;
    } else {
      const t = decodeDataUrlText(payload.dataUrl);
      if (t === null) {
        warnings.push(`sandbox file ${meta.path} returned malformed payload (skipped)`);
        continue;
      }
      text = t;
    }

    // Apply user's artifact-name template (default: "{{seqNum}} {{title}}").
    // Uploads keep the original basename — they're user-supplied content, not
    // Claude artifacts; renaming would obscure user intent. Sanitize anyway: a
    // malicious upload name with .. or path separators must not escape the
    // attachments dir.
    const filename =
      kind === "upload" ? sanitizeUploadBasename(rawName) : computeFilename(rawName, text, seqNum, naming);
    const relativeWritePath = relativeWritePathFor(kind, filename);

    const entry: SandboxFileContent = {
      path: meta.path,
      filename,
      relativeWritePath,
      contentType,
      isBinary,
      createdAt: meta.created_at,
      seqNum,
      kind,
    };
    if (binary) entry.binary = binary;
    if (text !== undefined) entry.text = text;

    result.push(entry);
  }

  // Detect basename collisions across artifacts: two outputs with the same
  // templated name would overwrite each other on disk. Warn rather than silently
  // clobber.
  const seen = new Map<string, string[]>();
  for (const f of result) {
    const arr = seen.get(f.relativeWritePath) ?? [];
    arr.push(f.path);
    seen.set(f.relativeWritePath, arr);
  }
  for (const [rel, paths] of seen) {
    if (paths.length > 1) {
      warnings.push(`sandbox files collide on output name ${rel}: ${paths.join(", ")} — only the last write will survive`);
    }
  }

  return { files: result, warnings };
}

/**
 * Materialize replayed research artifacts as `SandboxFileContent` entries so
 * they participate in the same naming/writing/linking flow as wiggle artifacts.
 * `seqStart` is the next available seqNum (continues from wiggle's last) so the
 * artifact-name template's {{seqNum}} stays unique across both sources.
 */
export function researchArtifactsAsSandboxFiles(
  artifacts: ResearchArtifact[],
  naming: SandboxFileNamingContext,
  seqStart: number,
): SandboxFileContent[] {
  const result: SandboxFileContent[] = [];
  let seqNum = seqStart;
  for (const art of artifacts) {
    seqNum++;
    const ext = getExtFromMime(art.mimeType);
    const template = naming.artifactNameTemplate ?? DEFAULT_ARTIFACT_NAME_TEMPLATE;
    const base = applyFilenameTemplate(template, {
      seqNum: String(seqNum).padStart(2, "0"),
      title: sanitizeForFilename(art.title),
      titleSanitized: sanitizeForFilename(art.title).toLowerCase().replace(/\s+/g, "_").slice(0, 50),
      chatTitle: naming.chatTitle,
      chatTitleSanitized: naming.chatTitleSanitized,
      chatCreated: naming.chatCreated,
    });
    const filename = `${base}${ext}`;
    result.push({
      // Synthetic: research artifacts have no real sandbox path. The artifactId
      // field is what the converter matches against tool_use.input.id.
      path: `research-artifact:${art.id}`,
      filename,
      relativeWritePath: filename,
      contentType: art.mimeType || "text/plain",
      isBinary: false,
      text: art.content,
      createdAt: "",
      seqNum,
      kind: "artifact",
      artifactId: art.id,
    });
  }
  return result;
}
