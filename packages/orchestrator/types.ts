import type { CdpClient } from "../chrome/index.ts";

export interface FileSystem {
  /** Returns the file's text contents, or null if the file doesn't exist. */
  readText(path: string): Promise<string | null>;
  /** Creates or overwrites the file. */
  writeText(path: string, content: string): Promise<void>;
  /** Creates or overwrites a binary file. */
  writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  /** True if the path exists (file or directory). */
  exists(path: string): Promise<boolean>;
  /** Recursively delete a directory; no-op if it doesn't exist. */
  deleteDir(path: string): Promise<void>;
  /** Recursively create a directory if missing. */
  ensureDir(path: string): Promise<void>;
  /** Platform-aware path join. */
  joinPath(...parts: string[]): string;
}

export interface ExportOptions {
  conversationId: string;

  // Layout
  outputDir: string;
  attachmentsDir?: string;

  // Rendering
  format: "standard" | "obsidian";
  templateText?: string;
  chatName?: string;
  chatNameTemplate?: string;
  artifactNameTemplate?: string;
  includeArtifacts: boolean;
  includeThinking: boolean;
  includeToolCalls: boolean;
  includeImages: boolean;

  // Enrichment
  toc: boolean;
  tocRecap: boolean;
  topics: boolean;
  claudePath?: string;

  // Refresh
  existingFilePath?: string;
  patchInProgress: boolean;
  /** When true, look up `<outputDir>/<datedTitle>.md` and treat it as existingFilePath if found. */
  discoverExistingByDatedTitle?: boolean;

  // Chrome
  chromePath?: string;
  chromePort?: number;
}

export interface ExportDeps {
  fs: FileSystem;
  onStatus?: (msg: string) => void;
  signal?: AbortSignal;
  /** Test seam — bypass Chrome lifecycle. */
  cdpOverride?: Pick<CdpClient, "fetchConversation" | "fetchImageAsDataUrl">;
}

export interface ExportResult {
  filePath: string;
  attachmentsDir: string | null;
  title: string;
  datedTitle: string;
  messageCount: number;
  artifactCount: number;
  imageCount: number;
  previousMessageCount?: number;
  tocReused: boolean;
  tocRegenerated: boolean;
  warnings: string[];
}
