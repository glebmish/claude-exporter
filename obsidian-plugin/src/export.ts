import { App } from "obsidian";
import { runExport as runOrchestratorExport } from "../../packages/orchestrator/index.ts";
import type { ExportOptions } from "../../packages/orchestrator/index.ts";
import { VaultFs } from "./fs-vault.ts";
import {
  findChrome, isAlreadyRunning, launchChrome, waitForReady,
  CdpClient, extractAuth, log, shutdownChrome,
} from "../../packages/chrome/index.ts";
import { parseConversationId } from "../../packages/converter/index.ts";

export interface ExportSettings {
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
  previousMessageCount?: number;
}

export interface ChromeSession {
  cdp: CdpClient;
  child: import("child_process").ChildProcess | null;
  /** Called after runExport releases Chrome — caller should drop its references. */
  onReleased?: () => void;
}

export async function runExport(
  app: App,
  settings: ExportSettings,
  conversationId: string,
  onStatus: StatusCallback,
  signal?: AbortSignal,
  chrome?: ChromeSession,
): Promise<ExportResult> {
  log("Starting export for:", conversationId);
  const fs = new VaultFs(app);

  // Read template if configured
  let templateText: string | undefined;
  if (settings.templatePath) {
    const tpl = await fs.readText(settings.templatePath);
    if (tpl !== null) templateText = tpl;
    else log(`Template file not found at ${settings.templatePath}`);
  }

  const wantsToc = !!settings.enableToc && !!templateText && /\{\{toc\}\}/.test(templateText);
  const wantsRecap = !!settings.enableToc && !!templateText && /\{\{tocWithRecap\}\}/.test(templateText);
  const wantsTopics = !!settings.enableToc && !!templateText && /\{\{(keyTopics|keyTopicsFlat)\}\}/.test(templateText);

  const opts: ExportOptions = {
    conversationId,
    outputDir: settings.exportFolder,
    attachmentsDir: settings.artifactsFolder,
    format: "obsidian",
    ...(templateText ? { templateText } : {}),
    ...(settings.chatNameTemplate ? { chatNameTemplate: settings.chatNameTemplate } : {}),
    ...(settings.artifactNameTemplate ? { artifactNameTemplate: settings.artifactNameTemplate } : {}),
    includeArtifacts: true,
    includeThinking: settings.includeThinking,
    includeToolCalls: settings.includeToolCalls,
    includeImages: true,
    toc: wantsToc,
    tocRecap: wantsRecap,
    topics: wantsTopics,
    ...(settings.claudePath ? { claudePath: settings.claudePath } : {}),
    patchInProgress: true,
    discoverExistingByDatedTitle: true,
    chromePath: settings.chromePath,
  };

  const result = await runOrchestratorExport(opts, {
    fs,
    onStatus,
    signal,
    ...(chrome ? {
      cdpOverride: chrome.cdp,
      onFetchComplete: () => {
        chrome.cdp.close();
        if (chrome.child) shutdownChrome(chrome.child);
        chrome.onReleased?.();
      },
    } : {}),
  });
  return {
    filePath: result.filePath,
    title: result.title,
    messageCount: result.messageCount,
    artifactCount: result.artifactCount,
    ...(result.previousMessageCount !== undefined ? { previousMessageCount: result.previousMessageCount } : {}),
  };
}

export async function browseAndPick(
  settings: ExportSettings,
  onStatus: StatusCallback,
  signal?: AbortSignal,
): Promise<{
  conversationId: string;
  cdp: CdpClient;
  child: import("child_process").ChildProcess | null;
}> {
  onStatus("Opening Claude...");
  let child: import("child_process").ChildProcess | null = null;
  const alreadyRunning = await isAlreadyRunning();

  if (!alreadyRunning) {
    const chromePath = findChrome(settings.chromePath);
    child = launchChrome(chromePath, "https://claude.ai");
  }

  let cdp: CdpClient | null = null;
  try {
    if (signal?.aborted) throw new Error("Cancelled");
    await waitForReady({ signal });

    cdp = await CdpClient.connect();

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

    onStatus("Choose a chat in Chrome...");
    while (true) {
      if (signal?.aborted) throw new Error("Cancelled");
      const url = (await cdp.evaluate("window.location.href")) as string;
      const id = parseConversationId(url || "");
      if (id) return { conversationId: id, cdp, child };
      await new Promise((r) => setTimeout(r, 500));
    }
  } catch (err) {
    if (cdp) cdp.close();
    if (child) shutdownChrome(child);
    throw err;
  }
}
