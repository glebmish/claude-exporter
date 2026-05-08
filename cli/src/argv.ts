import { parseConversationId } from "../../packages/converter/index.ts";
import type { ExportOptions } from "../../packages/orchestrator/index.ts";

export type ArgvResult =
  | { kind: "ok"; opts: ExportOptions; json: boolean; debug: boolean; templatePath?: string }
  | { kind: "error"; message: string };

const USAGE = `Usage: claude-export <chat-url-or-id> [flags]

Layout:
  -o, --output-dir <dir>              Note directory (default: .)
      --attachments-dir <dir>         Attachments destination (override)

Rendering:
      --format standard|obsidian      (default: standard)
      --template <path>               Markdown template file
      --chat-name <name>              Literal chat filename
      --chat-name-template <tpl>      Templated chat filename
      --artifact-name-template <tpl>  Templated artifact filename

Content:
      --no-artifacts                  Skip artifact files
      --no-images                     Skip inline image fetch
      --thinking                      Include assistant thinking
      --tools                         Include tool-call details

Enrichment (mutually exclusive with --template; with --template, declare via placeholders):
      --toc headers|recap             AI table of contents (recap adds per-topic summaries)
      --topics                        Key-topics list

Refresh:
      --existing <md-path>            Existing markdown for TOC reuse (in-progress patch is automatic)

Output:
      --json                          Machine-readable single-object stdout
      --debug                         Verbose logging to stderr

Chrome:
      --chrome-path <path>            (env: CHROME_PATH)
      --chrome-port <n>               (default: 9222)
`;

interface MutableOpts {
  positional: string | null;
  outputDir: string;
  attachmentsDir?: string;
  format: "standard" | "obsidian";
  templatePath?: string;
  chatName?: string;
  chatNameTemplate?: string;
  artifactNameTemplate?: string;
  includeArtifacts: boolean;
  includeImages: boolean;
  includeThinking: boolean;
  includeToolCalls: boolean;
  toc: boolean;
  tocRecap: boolean;
  topics: boolean;
  existingFilePath?: string;
  json: boolean;
  debug: boolean;
  chromePath?: string;
  chromePort?: number;
}

function err(message: string): ArgvResult {
  return { kind: "error", message };
}

function takeValue(args: string[], i: number, name: string): string | { errMsg: string } {
  if (i + 1 >= args.length) return { errMsg: `${name} requires a value` };
  return args[i + 1];
}

export function parseArgv(args: string[]): ArgvResult {
  const o: MutableOpts = {
    positional: null,
    outputDir: ".",
    format: "standard",
    includeArtifacts: true,
    includeImages: true,
    includeThinking: false,
    includeToolCalls: false,
    toc: false,
    tocRecap: false,
    topics: false,
    json: false,
    debug: false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--output-dir" || a === "-o") {
      const v = takeValue(args, i, a); if (typeof v !== "string") return err(v.errMsg);
      o.outputDir = v; i++;
    } else if (a === "--attachments-dir") {
      const v = takeValue(args, i, a); if (typeof v !== "string") return err(v.errMsg);
      o.attachmentsDir = v; i++;
    } else if (a === "--format") {
      const v = takeValue(args, i, a); if (typeof v !== "string") return err(v.errMsg);
      if (v !== "standard" && v !== "obsidian") return err(`--format must be 'standard' or 'obsidian'`);
      o.format = v; i++;
    } else if (a === "--template") {
      const v = takeValue(args, i, a); if (typeof v !== "string") return err(v.errMsg);
      o.templatePath = v; i++;
    } else if (a === "--chat-name") {
      const v = takeValue(args, i, a); if (typeof v !== "string") return err(v.errMsg);
      o.chatName = v; i++;
    } else if (a === "--chat-name-template") {
      const v = takeValue(args, i, a); if (typeof v !== "string") return err(v.errMsg);
      o.chatNameTemplate = v; i++;
    } else if (a === "--artifact-name-template") {
      const v = takeValue(args, i, a); if (typeof v !== "string") return err(v.errMsg);
      o.artifactNameTemplate = v; i++;
    } else if (a === "--no-artifacts") { o.includeArtifacts = false; }
    else if (a === "--no-images") { o.includeImages = false; }
    else if (a === "--thinking") { o.includeThinking = true; }
    else if (a === "--tools") { o.includeToolCalls = true; }
    else if (a === "--toc") {
      const v = takeValue(args, i, a); if (typeof v !== "string") return err(v.errMsg);
      if (v === "headers") { o.toc = true; }
      else if (v === "recap") { o.tocRecap = true; }
      else return err(`--toc must be 'headers' or 'recap'`);
      i++;
    }
    else if (a === "--topics") { o.topics = true; }
    else if (a === "--existing") {
      const v = takeValue(args, i, a); if (typeof v !== "string") return err(v.errMsg);
      o.existingFilePath = v; i++;
    } else if (a === "--json") { o.json = true; }
    else if (a === "--debug") { o.debug = true; }
    else if (a === "--chrome-path") {
      const v = takeValue(args, i, a); if (typeof v !== "string") return err(v.errMsg);
      o.chromePath = v; i++;
    } else if (a === "--chrome-port") {
      const v = takeValue(args, i, a); if (typeof v !== "string") return err(v.errMsg);
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) return err(`--chrome-port must be a positive integer`);
      o.chromePort = n; i++;
    } else if (a.startsWith("-")) {
      return err(`unknown flag: ${a}\n\n${USAGE}`);
    } else {
      if (o.positional !== null) return err(`unexpected extra positional argument: ${a}`);
      o.positional = a;
    }
  }

  if (!o.positional) return err(`missing chat URL or ID\n\n${USAGE}`);

  const conversationId = parseConversationId(o.positional);
  if (!conversationId) return err(`could not extract conversation ID from: ${o.positional}`);

  if (o.chatName !== undefined && o.chatNameTemplate !== undefined) {
    return err(`--chat-name and --chat-name-template are mutually exclusive`);
  }
  if (o.templatePath !== undefined && (o.toc || o.tocRecap || o.topics)) {
    return err(`--toc and --topics are not allowed with --template — declare enrichment via {{toc}}, {{tocWithRecap}}, {{keyTopics}}, or {{keyTopicsFlat}} placeholders in the template body`);
  }

  // Refresh implies patching the in-progress marker so concurrent readers don't pick up the stale file.
  const patchInProgress = o.existingFilePath !== undefined;

  const opts: ExportOptions = {
    conversationId,
    outputDir: o.outputDir,
    ...(o.attachmentsDir ? { attachmentsDir: o.attachmentsDir } : {}),
    format: o.format,
    ...(o.chatName !== undefined ? { chatName: o.chatName } : {}),
    ...(o.chatNameTemplate !== undefined ? { chatNameTemplate: o.chatNameTemplate } : {}),
    ...(o.artifactNameTemplate !== undefined ? { artifactNameTemplate: o.artifactNameTemplate } : {}),
    includeArtifacts: o.includeArtifacts,
    includeImages: o.includeImages,
    includeThinking: o.includeThinking,
    includeToolCalls: o.includeToolCalls,
    toc: o.toc,
    tocRecap: o.tocRecap,
    topics: o.topics,
    ...(o.existingFilePath ? { existingFilePath: o.existingFilePath } : {}),
    patchInProgress,
    ...(o.chromePath ? { chromePath: o.chromePath } : {}),
    ...(o.chromePort !== undefined ? { chromePort: o.chromePort } : {}),
  };

  return {
    kind: "ok",
    opts,
    json: o.json,
    debug: o.debug,
    ...(o.templatePath ? { templatePath: o.templatePath } : {}),
  };
}
