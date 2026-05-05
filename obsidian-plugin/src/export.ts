import { App, TFile, TFolder, normalizePath } from "obsidian";
import { parseConversation, renderDefault, collectImages, sanitizeFilename, parseConversationId, buildEnrichmentInput } from "../../packages/converter/index.ts";
import { applyTemplate } from "./template.ts";
import { enrichWithToc, parseTocFromMarkdown, parseKeyTopicsFromMarkdown, parseKeyTopicsFlatFromTemplate, reuseExistingToc } from "../../packages/toc/index.ts";
import type { TocTopic } from "../../packages/toc/index.ts";
import { findChrome, isAlreadyRunning, launchChrome, waitForReady, shutdownChrome, CdpClient, extractAuth, log } from "../../packages/chrome/index.ts";

const xlog = {
  info:  (...a: unknown[]) => console.log( "[claude-exporter]", ...a),
  warn:  (...a: unknown[]) => console.warn("[claude-exporter]", ...a),
  error: (...a: unknown[]) => console.error("[claude-exporter]", ...a),
};

/**
 * Scan a template for a frontmatter line that uses {{exported}}.
 * Returns the YAML key name (e.g. "exported", "refreshed") or null if not found.
 * Also accepts the full markdown body — searches everywhere, not just frontmatter.
 */
function findExportedKey(templateText: string): string | null {
  const match = templateText.match(/^([\w-]+):\s*[^\n]*\{\{exported\}\}/m);
  return match ? match[1] : null;
}

/**
 * Replace the value of a frontmatter key with "updating".
 * Only modifies the first YAML frontmatter block (between --- markers).
 */
function patchInProgress(content: string, key: string): string {
  // Scope replacement to the frontmatter block only — never touch message body
  return content.replace(
    /^(---\n[\s\S]*?\n---)/m,
    (frontmatter) =>
      frontmatter.replace(
        new RegExp(`^(${key}:\\s*)([^\\n]*)`, "m"),
        "$1updating",
      ),
  );
}

interface ExportSettings {
  exportFolder: string;
  artifactsFolder: string;
  chromePath: string;
  templatePath: string;
  chatNameTemplate: string;
  artifactNameTemplate: string;
  includeThinking: boolean;
  includeToolCalls: boolean;
  enableToc: boolean;
  claudePath: string;
}

type StatusCallback = (msg: string) => void;

export interface ExportResult {
  filePath: string;
  title: string;
  messageCount: number;
  artifactCount: number;
  previousMessageCount?: number;  // set when refreshing an existing file with a parseable TOC
}

interface ImageFile {
  msgIndex: number;
  filename: string;
  dataUrl: string;
}

export async function runExport(
  app: App,
  settings: ExportSettings,
  conversationId: string,
  onStatus: StatusCallback,
  signal?: AbortSignal
): Promise<ExportResult> {
  // 1. Launch Chrome (or reuse existing)
  onStatus("Launching Chrome...");
  log("Starting export for:", conversationId);
  let child: import("child_process").ChildProcess | null = null;
  const chatUrl = `https://claude.ai/chat/${conversationId}`;
  const alreadyRunning = await isAlreadyRunning();
  log("Chrome already running:", alreadyRunning);

  if (!alreadyRunning) {
    const chromePath = findChrome(settings.chromePath);
    child = launchChrome(chromePath, chatUrl);
  }

  try {
    if (signal?.aborted) throw new Error("Cancelled");
    await waitForReady({ signal });

    // 2. Connect CDP, wait for page and login
    onStatus("Connecting...");
    const cdp = await CdpClient.connect();

    try {
      if (!alreadyRunning) {
        await cdp.navigateTo(chatUrl);
      }

      // Wait for login
      let loggedIn = false;
      while (!loggedIn) {
        if (signal?.aborted) throw new Error("Cancelled");
        const cookies = await cdp.getCookies("claude.ai");
        loggedIn = !!extractAuth(cookies);
        if (!loggedIn) {
          onStatus("Waiting for login in Chrome window...");
          await new Promise((r) => setTimeout(r, 2000));
        }
      }

      // 3. Fetch conversation via browser
      if (signal?.aborted) throw new Error("Cancelled");
      onStatus("Fetching conversation...");
      const data = await cdp.fetchConversation(conversationId) as any;

      // 4. Fetch images via browser
      const messages = data.chat_messages || [];
      const imageMeta = collectImages(messages);
      const imageFiles: ImageFile[] = [];
      let seqNum = 0;
      for (const img of imageMeta) {
        seqNum++;
        onStatus(`Fetching image ${seqNum}/${imageMeta.length}...`);
        const dataUrl = await cdp.fetchImageAsDataUrl(img.url);
        if (!dataUrl) continue;
        const ext = img.fileName.match(/\.\w+$/)?.[0] || ".png";
        const base = sanitizeFilename(img.fileName.replace(/\.\w+$/, ""));
        const filename = `${String(seqNum).padStart(2, "0")}_${base}${ext}`;
        imageFiles.push({ msgIndex: img.msgIndex, filename, dataUrl });
      }

      // Browser no longer needed — close it before the (potentially slow) Claude call
      cdp.close();
      shutdownChrome(child);
      child = null;

      // 5. Convert
      onStatus("Converting...");
      xlog.info(`Converting "${data.name}" (${data.chat_messages?.length} messages)`);
      const parsed = parseConversation(
        data,
        { format: "obsidian", includeArtifacts: true, includeThinking: settings.includeThinking, includeToolCalls: settings.includeToolCalls },
        {
          conversationId,
          artifactsFolder: normalizePath(settings.artifactsFolder),
          imageFilenames: imageFiles.map((f) => ({ msgIndex: f.msgIndex, filename: f.filename })),
          chatNameTemplate: settings.chatNameTemplate,
          artifactNameTemplate: settings.artifactNameTemplate,
        }
      );

      // --- Existing file awareness ---
      const mdPath = normalizePath(`${settings.exportFolder}/${parsed.datedTitle}.md`);
      let existingToc: TocTopic[] | undefined;
      let previousMessageCount: number | undefined;
      let savedExistingContent: string | undefined;

      const existingFile = app.vault.getAbstractFileByPath(mdPath);
      if (existingFile instanceof TFile) {
        const existingContent = await app.vault.read(existingFile);
        savedExistingContent = existingContent;
        const parsedToc = parseTocFromMarkdown(existingContent);
        if (parsedToc) {
          existingToc = parsedToc.topics;
          previousMessageCount = parsedToc.lastCoveredMsg;
          xlog.info(`Existing TOC found — ${existingToc.length} entries, lastCoveredMsg: ${previousMessageCount}`);

          // Determine which frontmatter key maps to {{exported}}
          let exportedKey: string | null = null;
          if (settings.templatePath) {
            const tplFile = app.vault.getAbstractFileByPath(settings.templatePath);
            if (tplFile instanceof TFile) {
              const tplText = await app.vault.read(tplFile);
              exportedKey = findExportedKey(tplText);
            } else {
              xlog.info(`Template file not found at ${settings.templatePath} — skipping in-progress patch`);
            }
          } else {
            exportedKey = "exported"; // renderDefault always uses this key
          }

          if (exportedKey) {
            const patched = patchInProgress(existingContent, exportedKey);
            await app.vault.modify(existingFile, patched);
            xlog.info(`Patched existing file with in-progress marker (key: ${exportedKey})`);
          } else {
            xlog.info(`No {{exported}} variable in template — skipping in-progress patch`);
          }
        } else {
          xlog.info(`Existing file found but TOC could not be parsed — proceeding with full generation`);
        }
      }
      // --- End existing file awareness ---

      let markdown: string;
      if (settings.templatePath) {
        const templateFile = app.vault.getAbstractFileByPath(settings.templatePath);
        if (templateFile instanceof TFile) {
          const templateText = await app.vault.read(templateFile);
          xlog.info(`Template loaded: ${settings.templatePath}`);

          const tocVars = ["{{toc}}", "{{tocWithRecap}}", "{{keyTopics}}", "{{keyTopicsFlat}}"];
          const tocVarsPresent = tocVars.filter(v => templateText.includes(v));

          if (tocVarsPresent.length > 0) {
            xlog.info(`TOC template variables detected: ${tocVarsPresent.join(", ")}`);
            if (!settings.enableToc) {
              xlog.warn(`TOC variables present in template but "AI Table of Contents" is disabled in settings — skipping enrichment`);
            } else if (!settings.claudePath) {
              xlog.warn(`TOC enabled but Claude path is not configured — skipping enrichment`);
            }
          }

          const tocUpToDate = existingToc !== undefined &&
            previousMessageCount !== undefined &&
            previousMessageCount >= parsed.messageCount;
          const needsToc = settings.enableToc && !!settings.claudePath && tocVarsPresent.length > 0;
          const keyTopicVarsPresent = tocVarsPresent.some(v => v === "{{keyTopics}}" || v === "{{keyTopicsFlat}}");
          const recapVarsPresent = tocVarsPresent.includes("{{tocWithRecap}}");
          let enriched;
          if (needsToc && tocUpToDate) {
            const existingContent = savedExistingContent!;
            const existingKeyTopics =
              parseKeyTopicsFromMarkdown(existingContent) ??
              parseKeyTopicsFlatFromTemplate(existingContent, templateText);
            const keyTopicsRecoverable = !keyTopicVarsPresent || existingKeyTopics !== null;
            const recapRecoverable = !recapVarsPresent || existingToc!.some(t => t.recap !== "");
            if (keyTopicsRecoverable && recapRecoverable) {
              xlog.info(`TOC is up to date (lastCoveredMsg=${previousMessageCount} >= messageCount=${parsed.messageCount}) — reusing existing TOC`);
              enriched = reuseExistingToc(parsed, existingToc!, "obsidian", existingKeyTopics);
            } else {
              xlog.info(`TOC is up to date but ${!keyTopicsRecoverable ? "keyTopics" : "recap"} not recoverable — regenerating via Claude`);
              onStatus("Generating table of contents...");
              enriched = await enrichWithToc(parsed, buildEnrichmentInput(data), "obsidian", settings.claudePath, existingToc);
              xlog.info(`TOC enrichment complete`);
            }
          } else if (needsToc) {
            xlog.info(`Enriching with TOC via Claude (path: ${settings.claudePath})...`);
            onStatus("Generating table of contents...");
            enriched = await enrichWithToc(parsed, buildEnrichmentInput(data), "obsidian", settings.claudePath, existingToc);
            xlog.info(`TOC enrichment complete`);
          } else {
            enriched = parsed;
          }

          markdown = applyTemplate(templateText, enriched);
          xlog.info(`Template applied, output length: ${markdown.length} chars`);
        } else {
          xlog.warn(`Template file not found at path: ${settings.templatePath} — using default format`);
          markdown = renderDefault(parsed);
        }
      } else {
        xlog.info(`No template configured — using default format`);
        markdown = renderDefault(parsed);
      }

      // 6. Write files
      onStatus("Writing files...");
      const filePath = await writeToVault(
        app,
        settings.exportFolder,
        settings.artifactsFolder,
        parsed.datedTitle,
        markdown,
        parsed.artifactFiles,
        imageFiles
      );

      return {
        filePath,
        title: (data.name || "Claude Conversation").replace(/\s*\^archived$/i, ""),
        messageCount: parsed.messageCount,
        artifactCount: parsed.artifactFiles.length,
        ...(previousMessageCount !== undefined ? { previousMessageCount } : {}),
      };
    } finally {
      // cdp and chrome may already be closed (closed early after image fetch)
      cdp.close();
    }
  } finally {
    if (child) shutdownChrome(child);
  }
}

/**
 * Opens Claude in Chrome and waits for the user to navigate to a chat.
 * Returns the conversation ID once a chat URL is detected.
 * Chrome stays running so runExport can reuse it.
 */
export async function browseAndPick(
  settings: ExportSettings,
  onStatus: StatusCallback,
  signal?: AbortSignal
): Promise<{ conversationId: string; child: import("child_process").ChildProcess | null }> {
  onStatus("Opening Claude...");
  let child: import("child_process").ChildProcess | null = null;
  const alreadyRunning = await isAlreadyRunning();

  if (!alreadyRunning) {
    const chromePath = findChrome(settings.chromePath);
    child = launchChrome(chromePath, "https://claude.ai");
  }

  if (signal?.aborted) throw new Error("Cancelled");
  await waitForReady({ signal });

  const cdp = await CdpClient.connect();
  try {
    // Wait for auth first
    let hasAuth = false;
    while (!hasAuth) {
      if (signal?.aborted) throw new Error("Cancelled");
      const cookies = await cdp.getCookies("claude.ai");
      hasAuth = !!extractAuth(cookies);
      if (!hasAuth) {
        onStatus("Log in to Claude in the browser...");
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    // Poll URL until user opens a chat
    onStatus("Choose a chat in Chrome...");
    while (true) {
      if (signal?.aborted) throw new Error("Cancelled");
      const url = (await cdp.evaluate("window.location.href")) as string;
      const id = parseConversationId(url || "");
      if (id) return { conversationId: id, child };
      await new Promise((r) => setTimeout(r, 500));
    }
  } finally {
    cdp.close();
  }
}

async function writeToVault(
  app: App,
  exportFolder: string,
  artifactsFolder: string,
  datedTitle: string,
  markdown: string,
  artifactFiles: Array<{ filename: string; content: string }>,
  imageFiles: ImageFile[]
): Promise<string> {
  // Main markdown file goes directly in the export folder
  await ensureFolder(app, exportFolder);
  const mdPath = normalizePath(`${exportFolder}/${datedTitle}.md`);
  await writeOrOverwrite(app, mdPath, markdown);

  const hasAttachments = artifactFiles.length > 0 || imageFiles.length > 0;

  // Artifacts and images go to <artifactsFolder>/<datedTitle>/
  if (hasAttachments) {
    const attDir = normalizePath(`${artifactsFolder}/${datedTitle}`);

    // Delete stale attachments on re-export
    const existingDir = app.vault.getAbstractFileByPath(attDir);
    if (existingDir instanceof TFolder) {
      await app.vault.delete(existingDir, true);
    }

    await ensureFolder(app, attDir);

    for (const art of artifactFiles) {
      const artPath = normalizePath(`${attDir}/${art.filename}`);
      await writeOrOverwrite(app, artPath, art.content);
    }

    for (const img of imageFiles) {
      const imgPath = normalizePath(`${attDir}/${img.filename}`);
      const base64 = img.dataUrl.split(",")[1];
      if (base64) {
        const binary = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        await writeBinary(app, imgPath, binary.buffer);
      }
    }
  }

  return mdPath;
}

async function ensureFolder(app: App, path: string): Promise<void> {
  if (app.vault.getAbstractFileByPath(path)) return;
  // Create parent directories recursively
  const parts = path.split("/");
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) {
      await app.vault.createFolder(current);
    }
  }
}

async function writeOrOverwrite(
  app: App,
  path: string,
  content: string
): Promise<void> {
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modify(existing, content);
  } else {
    await app.vault.create(path, content);
  }
}

async function writeBinary(
  app: App,
  path: string,
  data: ArrayBuffer
): Promise<void> {
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof TFile) {
    await app.vault.modifyBinary(existing, data);
  } else {
    await app.vault.createBinary(path, data);
  }
}
