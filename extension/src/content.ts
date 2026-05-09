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

// --- Message listener ---

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action !== "export") return;

  (async () => {
    const data = await fetchConversation();
    const messages = data.chat_messages || [];

    // Fetch images
    const imageFiles = messages.length > 0 ? await fetchAllImages(messages) : [];

    const result = buildMarkdown(
      data,
      { format: "standard", ...msg.options },
      {
        conversationId: getConversationId(),
        imageFilenames: imageFiles.map((f) => ({
          msgIndex: f.msgIndex,
          filename: f.filename,
        })),
      }
    );

    return {
      success: true,
      markdown: result.markdown,
      artifactFiles: result.artifactFiles,
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
