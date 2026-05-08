import type { ExportOptions, ExportDeps, ExportResult } from "./types.ts";
import {
  parseConversation,
  renderDefault,
  buildEnrichmentInput,
} from "../converter/index.ts";
import type { ConversationData } from "../converter/index.ts";
import {
  findChrome,
  isAlreadyRunning,
  launchChrome,
  waitForReady,
  shutdownChrome,
  CdpClient,
  extractAuth,
} from "../chrome/index.ts";
import { fetchAllImages, decodeDataUrl } from "./images.ts";
import type { ImageFile } from "./images.ts";
import { applyTemplate } from "./template.ts";
import {
  loadExistingFile,
  applyInProgressPatch,
  decideEnrichment,
  type ExistingFileInfo,
  type TemplateVarPresence,
} from "./refresh.ts";

export type { FileSystem, ExportOptions, ExportDeps, ExportResult } from "./types.ts";
export { applyTemplate, findExportedKey, patchInProgress } from "./template.ts";
export { fetchAllImages, decodeDataUrl } from "./images.ts";
export type { ImageFile } from "./images.ts";
export { loadExistingFile, applyInProgressPatch, decideEnrichment } from "./refresh.ts";
export type { ExistingFileInfo, EnrichmentDecision, TemplateVarPresence, EnrichmentFlags } from "./refresh.ts";

const TOC_VAR_RE = /\{\{(toc|tocWithRecap|keyTopics|keyTopicsFlat)\}\}/g;

function scanTemplateVars(templateText: string | undefined): TemplateVarPresence {
  const flags: TemplateVarPresence = { hasToc: false, hasTocWithRecap: false, hasKeyTopics: false, hasKeyTopicsFlat: false };
  if (!templateText) return flags;
  for (const m of templateText.matchAll(TOC_VAR_RE)) {
    if (m[1] === "toc") flags.hasToc = true;
    else if (m[1] === "tocWithRecap") flags.hasTocWithRecap = true;
    else if (m[1] === "keyTopics") flags.hasKeyTopics = true;
    else if (m[1] === "keyTopicsFlat") flags.hasKeyTopicsFlat = true;
  }
  return flags;
}

async function withCdp<T>(
  opts: ExportOptions,
  deps: ExportDeps,
  fn: (cdp: CdpClient) => Promise<T>,
): Promise<T> {
  const port = opts.chromePort ?? 9222;
  const chatUrl = `https://claude.ai/chat/${opts.conversationId}`;
  let child: import("node:child_process").ChildProcess | null = null;
  const alreadyRunning = await isAlreadyRunning(port);

  if (!alreadyRunning) {
    deps.onStatus?.("Launching Chrome...");
    const chromePath = findChrome(opts.chromePath);
    child = launchChrome(chromePath, chatUrl, { port });
  }

  try {
    if (deps.signal?.aborted) throw new Error("Cancelled");
    await waitForReady({ port, signal: deps.signal });
    const cdp = await CdpClient.connect(port);
    try {
      if (!alreadyRunning) await cdp.navigateTo(chatUrl);
      // Wait for login
      while (true) {
        if (deps.signal?.aborted) throw new Error("Cancelled");
        const cookies = await cdp.getCookies("claude.ai");
        if (extractAuth(cookies)) break;
        deps.onStatus?.("Waiting for login in Chrome window...");
        await new Promise((r) => setTimeout(r, 2000));
      }
      return await fn(cdp);
    } finally {
      cdp.close();
    }
  } finally {
    if (child) shutdownChrome(child);
  }
}

async function fetchData(
  opts: ExportOptions,
  deps: ExportDeps,
): Promise<{ data: ConversationData; imageFiles: ImageFile[] }> {
  if (deps.cdpOverride) {
    deps.onStatus?.("Fetching conversation...");
    const data = (await deps.cdpOverride.fetchConversation(opts.conversationId)) as ConversationData;
    const messages = data.chat_messages || [];
    const imageFiles = opts.includeImages
      ? await fetchAllImages(deps.cdpOverride, messages, deps.onStatus, deps.signal)
      : [];
    return { data, imageFiles };
  }
  return withCdp(opts, deps, async (cdp) => {
    if (deps.signal?.aborted) throw new Error("Cancelled");
    deps.onStatus?.("Fetching conversation...");
    const data = (await cdp.fetchConversation(opts.conversationId)) as ConversationData;
    const messages = data.chat_messages || [];
    const imageFiles = opts.includeImages
      ? await fetchAllImages(cdp, messages, deps.onStatus, deps.signal)
      : [];
    return { data, imageFiles };
  });
}

export async function runExport(opts: ExportOptions, deps: ExportDeps): Promise<ExportResult> {
  if (opts.chatName !== undefined && opts.chatNameTemplate !== undefined) {
    throw new Error("chatName and chatNameTemplate are mutually exclusive");
  }
  if (opts.patchInProgress && !opts.existingFilePath && !opts.discoverExistingByDatedTitle) {
    throw new Error("patchInProgress requires existingFilePath or discoverExistingByDatedTitle");
  }

  // Phase 1: fetch conversation + images
  const { data, imageFiles } = await fetchData(opts, deps);
  if (deps.signal?.aborted) throw new Error("Cancelled");

  // Phase 2: parse
  deps.onStatus?.("Converting...");
  const attachmentsBaseDir = opts.attachmentsDir ?? opts.outputDir;
  const parsed = parseConversation(
    data,
    {
      format: opts.format,
      includeArtifacts: opts.includeArtifacts,
      includeThinking: opts.includeThinking,
      includeToolCalls: opts.includeToolCalls,
    },
    {
      conversationId: opts.conversationId,
      artifactsFolder: attachmentsBaseDir,
      imageFilenames: imageFiles.map((f) => ({ msgIndex: f.msgIndex, filename: f.filename })),
      ...(opts.chatName !== undefined ? { chatName: opts.chatName } : {}),
      ...(opts.chatNameTemplate !== undefined ? { chatNameTemplate: opts.chatNameTemplate } : {}),
      ...(opts.artifactNameTemplate !== undefined ? { artifactNameTemplate: opts.artifactNameTemplate } : {}),
    },
  );

  const warnings: string[] = [];

  // Phase 3: discover/load existing file
  let existingFilePath = opts.existingFilePath;
  if (!existingFilePath && opts.discoverExistingByDatedTitle) {
    const candidate = deps.fs.joinPath(opts.outputDir, `${parsed.datedTitle}.md`);
    if (await deps.fs.exists(candidate)) {
      existingFilePath = candidate;
    }
  }

  let existing: ExistingFileInfo = { existingKeyTopics: null, warnings: [] };
  let previousMessageCount: number | undefined;
  if (existingFilePath) {
    existing = await loadExistingFile(deps.fs, existingFilePath, opts.templateText);
    warnings.push(...existing.warnings);
    previousMessageCount = existing.previousMessageCount;
    if (opts.patchInProgress && existing.existingContent) {
      await applyInProgressPatch(deps.fs, existingFilePath, existing.existingContent, opts.templateText);
    }
  }

  // Phase 4: template-var scan + warnings
  const tplVars = scanTemplateVars(opts.templateText);
  const anyTplTocVar = tplVars.hasToc || tplVars.hasTocWithRecap || tplVars.hasKeyTopics || tplVars.hasKeyTopicsFlat;
  const anyEnrichmentFlag = opts.toc || opts.tocRecap || opts.topics;
  if (anyTplTocVar && !anyEnrichmentFlag) {
    warnings.push("template contains TOC variables but no enrichment flag is set — placeholders will be empty");
  }
  if (opts.tocRecap && opts.templateText && !tplVars.hasTocWithRecap) {
    warnings.push("--toc-recap set but template has no {{tocWithRecap}} placeholder — value will be dropped");
  }

  // Phase 5: enrichment
  const decision = await decideEnrichment(
    parsed,
    buildEnrichmentInput(data),
    opts.format,
    opts.claudePath,
    { toc: opts.toc, tocRecap: opts.tocRecap, topics: opts.topics },
    tplVars,
    existing,
  );
  warnings.push(...decision.warnings);
  const enriched = decision.enriched;

  // Phase 6: render
  const markdown = opts.templateText
    ? applyTemplate(opts.templateText, enriched)
    : renderDefault(enriched);

  // Phase 7: stale-attachment cleanup
  const hasAttachments = parsed.artifactFiles.length + imageFiles.length > 0;
  const attachmentsDirAbs = hasAttachments
    ? deps.fs.joinPath(attachmentsBaseDir, parsed.datedTitle)
    : null;
  if (existingFilePath) {
    // Always clean stale attachments when refreshing
    const staleDir = deps.fs.joinPath(attachmentsBaseDir, parsed.datedTitle);
    if (await deps.fs.exists(staleDir)) {
      await deps.fs.deleteDir(staleDir);
    }
  }

  // Phase 8: write
  if (deps.signal?.aborted) throw new Error("Cancelled");
  deps.onStatus?.("Writing files...");
  const notePath = deps.fs.joinPath(opts.outputDir, `${parsed.datedTitle}.md`);
  await deps.fs.ensureDir(opts.outputDir);
  await deps.fs.writeText(notePath, markdown);

  if (attachmentsDirAbs) {
    await deps.fs.ensureDir(attachmentsDirAbs);
    const artifactsSubdir = deps.fs.joinPath(attachmentsDirAbs, "artifacts");
    const imagesSubdir = deps.fs.joinPath(attachmentsDirAbs, "images");
    if (parsed.artifactFiles.length > 0) {
      await deps.fs.ensureDir(artifactsSubdir);
      for (const art of parsed.artifactFiles) {
        await deps.fs.writeText(deps.fs.joinPath(artifactsSubdir, art.filename), art.content);
      }
    }
    if (imageFiles.length > 0) {
      await deps.fs.ensureDir(imagesSubdir);
      for (const img of imageFiles) {
        const buf = decodeDataUrl(img.dataUrl);
        if (buf) await deps.fs.writeBinary(deps.fs.joinPath(imagesSubdir, img.filename), buf);
      }
    }
  }

  return {
    filePath: notePath,
    attachmentsDir: attachmentsDirAbs,
    title: (data.name || "Claude Conversation").replace(/\s*\^archived$/i, ""),
    datedTitle: parsed.datedTitle,
    messageCount: parsed.messageCount,
    artifactCount: parsed.artifactFiles.length,
    imageCount: imageFiles.length,
    ...(previousMessageCount !== undefined ? { previousMessageCount } : {}),
    tocReused: decision.tocReused,
    tocRegenerated: decision.tocRegenerated,
    warnings,
  };
}
