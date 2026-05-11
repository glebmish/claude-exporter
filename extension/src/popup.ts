declare const JSZip: any;

const STORAGE_KEY = "claudeExporterOptions";
const SETTINGS_KEY = "claudeExporterSettings";

const checkboxes: Record<string, HTMLInputElement> = {
  includeArtifacts: document.getElementById("includeArtifacts") as HTMLInputElement,
  includeThinking: document.getElementById("includeThinking") as HTMLInputElement,
  includeToolCalls: document.getElementById("includeToolCalls") as HTMLInputElement,
};

const exportBtn = document.getElementById("exportBtn") as HTMLButtonElement;
const copyBtn = document.getElementById("copyBtn") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLElement;

function setButtonsDisabled(disabled: boolean): void {
  exportBtn.disabled = disabled;
  copyBtn.disabled = disabled;
}

async function getActiveClaudeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let tabOrigin = "";
  try { tabOrigin = new URL(tab?.url ?? "").origin; } catch { /* invalid URL */ }
  return tabOrigin === "https://claude.ai" ? tab : null;
}

// Tabs opened before the extension was (re)loaded never receive the declared
// content script, so sendMessage rejects with "Receiving end does not exist".
// Inject on demand and retry instead of asking the user to refresh.
async function sendToContentScript(tabId: number, message: unknown): Promise<any> {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/Receiving end does not exist|Could not establish connection/i.test(msg)) {
      throw err;
    }
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["dist/content.js"],
    });
    return await chrome.tabs.sendMessage(tabId, message);
  }
}

// Settings link
document.getElementById("settingsLink")!.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

// Load saved options
chrome.storage.local.get(STORAGE_KEY, (result) => {
  const saved = result[STORAGE_KEY];
  if (saved) {
    for (const [key, el] of Object.entries(checkboxes)) {
      if (saved[key] !== undefined) el.checked = saved[key];
    }
  }
});

// Save options on change
for (const el of Object.values(checkboxes)) {
  el.addEventListener("change", saveOptions);
}

function saveOptions(): void {
  const options: Record<string, boolean> = {};
  for (const [key, el] of Object.entries(checkboxes)) {
    options[key] = el.checked;
  }
  chrome.storage.local.set({ [STORAGE_KEY]: options });
}

function setStatus(text: string, className?: string): void {
  statusEl.textContent = text;
  statusEl.className = className || "";
}

async function getOutputPath(): Promise<string> {
  return new Promise((resolve) => {
    chrome.storage.local.get(SETTINGS_KEY, (result) => {
      const settings = result[SETTINGS_KEY] || {};
      resolve(settings.outputPath || "claude-chats");
    });
  });
}

function chromeDownload(url: string, filename: string): Promise<number> {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      { url, filename, conflictAction: "uniquify" },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(downloadId);
        }
      }
    );
  });
}

interface SandboxFile {
  filename: string;
  /** Path relative to the chat folder inside the zip (e.g. `02-shape.md` or `uploads/IMG.png`) */
  relativeWritePath: string;
  contentType: string;
  /** data URL — same shape for text and binary, popup decodes the base64 payload */
  dataUrl: string;
}

interface ImageFile {
  filename: string;
  dataUrl: string;
}

async function saveExport(
  markdown: string,
  sandboxFiles: SandboxFile[],
  imageFiles: ImageFile[],
  datedTitle: string
): Promise<{ filename: string; extraCount: number }> {
  const outputPath = await getOutputPath();
  const prefix = outputPath.replace(/\/+$/, "");

  const zip = new JSZip();
  const folder = zip.folder(datedTitle);
  folder.file(`${datedTitle}.md`, markdown);

  // Sandbox files: write at relativeWritePath (uploads land under uploads/, artifacts flat).
  if (sandboxFiles && sandboxFiles.length > 0) {
    for (const f of sandboxFiles) {
      const base64 = f.dataUrl.split(",")[1];
      if (!base64) continue;
      folder.file(f.relativeWritePath, base64, { base64: true });
    }
  }

  if (imageFiles && imageFiles.length > 0) {
    for (const img of imageFiles) {
      const base64 = img.dataUrl.split(",")[1];
      if (base64) folder.file(img.filename, base64, { base64: true });
    }
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const blobUrl = URL.createObjectURL(blob);
  try {
    await chromeDownload(blobUrl, `${prefix}/${datedTitle}.zip`);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
  const totalFiles = (sandboxFiles?.length || 0) + (imageFiles?.length || 0);
  return { filename: `${datedTitle}.zip`, extraCount: totalFiles };
}

// --- Export ---

exportBtn.addEventListener("click", async () => {
  const options: Record<string, boolean> = {};
  for (const [key, el] of Object.entries(checkboxes)) {
    options[key] = el.checked;
  }

  setButtonsDisabled(true);
  setStatus("Exporting...", "status-working");

  try {
    const tab = await getActiveClaudeTab();
    if (!tab) {
      setStatus("Navigate to claude.ai first", "status-error");
      setButtonsDisabled(false);
      return;
    }

    const response = await sendToContentScript(tab.id!, {
      action: "export",
      options,
    });

    if (!response?.success) {
      setStatus(response?.error || "Export failed", "status-error");
      setButtonsDisabled(false);
      return;
    }

    const result = await saveExport(
      response.markdown,
      response.sandboxFiles,
      response.imageFiles,
      response.datedTitle
    );

    const extra = result.extraCount > 0 ? ` + ${result.extraCount} files` : "";
    setStatus(`${result.filename}${extra}`, "status-success");
  } catch (err: unknown) {
    console.error("Export error:", err);
    setStatus((err instanceof Error ? err.message : String(err)) || "Export failed", "status-error");
  }

  setButtonsDisabled(false);
});

copyBtn.addEventListener("click", async () => {
  setButtonsDisabled(true);
  setStatus("Copying...", "status-working");

  try {
    const tab = await getActiveClaudeTab();
    if (!tab) {
      setStatus("Navigate to claude.ai first", "status-error");
      setButtonsDisabled(false);
      return;
    }

    const response = await sendToContentScript(tab.id!, { action: "copyChat" });

    if (!response?.success) {
      setStatus(response?.error || "Copy failed", "status-error");
      setButtonsDisabled(false);
      return;
    }

    await navigator.clipboard.writeText(response.markdown);
    setStatus("Copied to clipboard", "status-success");
  } catch (err: unknown) {
    console.error("Copy error:", err);
    setStatus((err instanceof Error ? err.message : String(err)) || "Copy failed", "status-error");
  }

  setButtonsDisabled(false);
});
