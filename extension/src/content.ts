/* Claude Chat Exporter — content script injected on claude.ai */

import {
  buildMarkdown,
  collectImages,
  sanitizeFilename,
} from "../../packages/converter/index.ts";
import type { ConversationData, Message } from "../../packages/converter/types.ts";

function getConversationId(): string | undefined {
  const path = window.location.pathname.replace(/\/+$/, "");
  return path.split("/").pop();
}

function getOrgId(): string | undefined {
  return document.cookie.match(/lastActiveOrg=([^;]+)/)?.[1];
}

async function fetchConversation(): Promise<ConversationData> {
  const conversationId = getConversationId();
  const orgId = getOrgId();

  if (!conversationId || !orgId) {
    throw new Error(
      "Could not determine conversation or org ID. Make sure you are on a Claude.ai conversation page."
    );
  }

  const url = `/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=true&rendering_mode=messages&render_all_tools=true`;
  const response = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// --- Image fetching ---

async function fetchImage(url: string): Promise<string | null> {
  // Tolerate transport-level failures (offline, DNS, abort) the same way as a
  // non-OK HTTP response: skip this image rather than aborting the whole export.
  let response: Response;
  try {
    response = await fetch(url, { credentials: "include" });
  } catch (e) {
    console.warn(`[claude-export] failed to fetch ${url}:`, e);
    return null;
  }
  if (!response.ok) return null;
  const blob = await response.blob();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

interface ImageFile {
  msgIndex: number;
  filename: string;
  dataUrl: string;
}

async function fetchAllImages(
  messages: Message[]
): Promise<ImageFile[]> {
  const imageMeta = collectImages(messages);
  const imageFiles: ImageFile[] = [];
  let seqNum = 0;

  for (const img of imageMeta) {
    seqNum++;
    const dataUrl = await fetchImage(img.url);
    if (!dataUrl) continue;

    const ext = img.fileName.match(/\.\w+$/)?.[0] || ".png";
    const baseName = img.fileName.replace(/\.\w+$/, "");
    const filename = `${String(seqNum).padStart(2, "0")}_${sanitizeFilename(baseName)}${ext}`;

    imageFiles.push({ msgIndex: img.msgIndex, filename, dataUrl });
  }

  return imageFiles;
}

// --- Sandbox files (wiggle) ---

interface SandboxFileMetadata {
  path: string;
  size: number;
  content_type: string;
  created_at: string;
  custom_metadata?: Record<string, unknown>;
}

interface SandboxFileEntry {
  path: string;
  filename: string;
  /** Path relative to the per-chat attachments dir (e.g. `02-shape.md` or `uploads/IMG.png`) */
  relativeWritePath: string;
  contentType: string;
  /** data URL `data:<mime>;base64,...` — popup decodes for the zip */
  dataUrl: string;
}

function basename(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}

function isUpload(path: string): boolean {
  return path.startsWith("/mnt/user-data/uploads/");
}

async function downloadSandboxFile(
  orgId: string,
  conversationId: string,
  path: string,
): Promise<{ contentType: string; dataUrl: string } | null> {
  let response: Response;
  try {
    response = await fetch(
      `/api/organizations/${orgId}/conversations/${conversationId}/wiggle/download-file?path=${encodeURIComponent(path)}`,
      { credentials: "include" },
    );
  } catch (e) {
    console.warn(`[claude-export] failed to fetch sandbox file ${path}:`, e);
    return null;
  }
  if (!response.ok) return null;
  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const blob = await response.blob();
  const dataUrl: string = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
  return { contentType, dataUrl };
}

async function fetchAllSandboxFiles(
  orgId: string,
  conversationId: string,
): Promise<SandboxFileEntry[]> {
  let listResp: Response;
  try {
    listResp = await fetch(
      `/api/organizations/${orgId}/conversations/${conversationId}/wiggle/list-files?prefix=`,
      { credentials: "include" },
    );
  } catch (e) {
    console.warn("[claude-export] sandbox list-files failed:", e);
    return [];
  }
  if (!listResp.ok) return [];

  const list = (await listResp.json()) as { files_metadata?: SandboxFileMetadata[] };
  const metadata = (list.files_metadata ?? []).slice().sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
    return a.path < b.path ? -1 : 1;
  });

  const out: SandboxFileEntry[] = [];
  for (const meta of metadata) {
    const payload = await downloadSandboxFile(orgId, conversationId, meta.path);
    if (!payload) continue;
    const name = basename(meta.path);
    const relativeWritePath = isUpload(meta.path) ? `uploads/${name}` : name;
    out.push({
      path: meta.path,
      filename: name,
      relativeWritePath,
      contentType: payload.contentType,
      dataUrl: payload.dataUrl,
    });
  }
  return out;
}

// --- Message listener ---

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action !== "export") return;

  (async () => {
    const data = await fetchConversation();
    const messages = data.chat_messages || [];
    const orgId = getOrgId();
    const conversationId = getConversationId();

    // Fetch images and sandbox files in parallel
    const [imageFiles, sandboxFiles] = await Promise.all([
      messages.length > 0 ? fetchAllImages(messages) : Promise.resolve([] as ImageFile[]),
      orgId && conversationId ? fetchAllSandboxFiles(orgId, conversationId) : Promise.resolve([] as SandboxFileEntry[]),
    ]);

    const result = buildMarkdown(
      data,
      { format: "standard", ...msg.options },
      {
        conversationId,
        imageFilenames: imageFiles.map((f) => ({
          msgIndex: f.msgIndex,
          filename: f.filename,
        })),
        sandboxFiles: sandboxFiles.map((f) => ({ path: f.path, filename: f.filename, relativeWritePath: f.relativeWritePath })),
      }
    );

    return {
      success: true,
      markdown: result.markdown,
      sandboxFiles: sandboxFiles.map((f) => ({
        filename: f.filename,
        relativeWritePath: f.relativeWritePath,
        contentType: f.contentType,
        dataUrl: f.dataUrl,
      })),
      imageFiles: imageFiles.map((f) => ({
        filename: f.filename,
        dataUrl: f.dataUrl,
      })),
      datedTitle: result.datedTitle,
    };
  })()
    .then((result) => sendResponse(result))
    .catch((err) => sendResponse({ success: false, error: err.message }));

  return true; // async response
});
