import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseConversation, renderDefault, parseConversationId, buildEnrichmentInput } from "../../packages/converter/index.ts";
import type { ConversationData, ConversationResult } from "../../packages/converter/index.ts";
import {
  findChrome, launchChrome, isAlreadyRunning, waitForReady,
  shutdownChrome, CdpClient, log,
} from "../../packages/chrome/index.ts";
import type { ChildProcess } from "node:child_process";
import { enrichWithToc, parseTocFromMarkdown } from "../../packages/toc/index.ts";
import type { TocTopic } from "../../packages/toc/index.ts";

const CDP_PORT = 9222;

interface CliOptions {
  chatUrl: string | null;
  outputDir: string;
  includeArtifacts: boolean;
  includeThinking: boolean;
  includeToolCalls: boolean;
  debug: boolean;
  toc: boolean;
  tocRecap: boolean;
  topics: boolean;
  existingFile: string | null;
  chatNameTemplate: string | null;
  artifactNameTemplate: string | null;
}

function parseArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  const opts: CliOptions = {
    chatUrl: null,
    outputDir: '.',
    includeArtifacts: true,
    includeThinking: false,
    includeToolCalls: false,
    debug: false,
    toc: false,
    tocRecap: false,
    topics: false,
    existingFile: null,
    chatNameTemplate: null,
    artifactNameTemplate: null,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--output' || args[i] === '-o') {
      if (i + 1 >= args.length) { console.error('Error: --output requires a directory path'); process.exit(1); }
      opts.outputDir = args[++i];
    }
    else if (args[i] === '--thinking') { opts.includeThinking = true; }
    else if (args[i] === '--tools') { opts.includeToolCalls = true; }
    else if (args[i] === '--no-artifacts') { opts.includeArtifacts = false; }
    else if (args[i] === '--debug') { opts.debug = true; }
    else if (args[i] === '--toc') { opts.toc = true; }
    else if (args[i] === '--toc-recap') { opts.tocRecap = true; }
    else if (args[i] === '--topics') { opts.topics = true; }
    else if (args[i] === '--existing') {
      if (i + 1 >= args.length) { console.error('Error: --existing requires a file path'); process.exit(1); }
      opts.existingFile = args[++i];
    }
    else if (args[i] === '--chat-name') {
      if (i + 1 >= args.length) { console.error('Error: --chat-name requires a template'); process.exit(1); }
      opts.chatNameTemplate = args[++i];
    }
    else if (args[i] === '--artifact-name') {
      if (i + 1 >= args.length) { console.error('Error: --artifact-name requires a template'); process.exit(1); }
      opts.artifactNameTemplate = args[++i];
    }
    else if (!args[i].startsWith('-')) { opts.chatUrl = args[i]; }
  }
  return opts;
}

function writeExport(result: ConversationResult, outputDir: string): void {
  const markdown = renderDefault(result);
  const { artifactFiles, datedTitle } = result;
  const hasExtras = artifactFiles.length > 0;

  if (hasExtras) {
    const dir = join(outputDir, datedTitle);
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, 'artifacts'), { recursive: true });
    writeFileSync(join(dir, `${datedTitle}.md`), markdown);
    for (const art of artifactFiles) {
      writeFileSync(join(dir, 'artifacts', art.filename), art.content);
    }
    console.log(`Exported to ${dir}/`);
    console.log(`  ${datedTitle}.md + ${artifactFiles.length} artifacts`);
  } else {
    mkdirSync(outputDir, { recursive: true });
    const filepath = join(outputDir, `${datedTitle}.md`);
    writeFileSync(filepath, markdown);
    console.log(`Exported to ${filepath}`);
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  if (opts.debug) log.enable();
  if (!opts.chatUrl) {
    console.error('Usage: claude-export <chat-url-or-id> [--output <dir>] [--thinking] [--tools] [--no-artifacts] [--toc] [--toc-recap] [--topics] [--existing <file>] [--chat-name <tpl>] [--artifact-name <tpl>] [--debug]');
    process.exit(1);
  }
  const conversationId = parseConversationId(opts.chatUrl);
  if (!conversationId) {
    console.error('Could not extract conversation ID from:', opts.chatUrl);
    process.exit(1);
  }

  const chatUrl = `https://claude.ai/chat/${conversationId}`;
  let child: ChildProcess | null = null;
  let chromeWasLaunched = false;

  try {
    // Launch or reuse Chrome
    const running = await isAlreadyRunning(CDP_PORT);
    if (running) {
      console.log('Chrome debug session found, connecting...');
    } else {
      console.log('Launching Chrome (dedicated profile)...');
      chromeWasLaunched = true;
      const chromePath = findChrome(process.env.CHROME_PATH);
      child = launchChrome(chromePath, chatUrl, { port: CDP_PORT });
    }
    await waitForReady({ port: CDP_PORT, signal: AbortSignal.timeout(60_000) });

    // Connect CDP and wait for page to load
    const cdp = await CdpClient.connect(CDP_PORT);
    let data: ConversationData;

    try {
      if (chromeWasLaunched) {
        console.log('Waiting for page to load...');
        await cdp.navigateTo(chatUrl);
      }

      // Wait until logged in (orgId cookie exists)
      for (let i = 0; i < 120; i++) {
        const cookies = await cdp.getCookies("claude.ai");
        if (cookies.some(c => c.name === "lastActiveOrg" && c.value)) break;
        if (i === 0) console.log('Waiting for login...');
        await new Promise(r => setTimeout(r, 2000));
      }

      // Fetch conversation via the browser — avoids cookie/header issues
      console.log('Fetching conversation...');
      data = await cdp.fetchConversation(conversationId) as ConversationData;
    } finally {
      cdp.close();
    }

    console.log(`Converting "${data.name}" (${data.chat_messages?.length} messages)...`);
    const result = parseConversation(data as any, {
      format: "standard",
      includeArtifacts: opts.includeArtifacts,
      includeThinking: opts.includeThinking,
      includeToolCalls: opts.includeToolCalls,
    }, {
      conversationId,
      ...(opts.chatNameTemplate ? { chatNameTemplate: opts.chatNameTemplate } : {}),
      ...(opts.artifactNameTemplate ? { artifactNameTemplate: opts.artifactNameTemplate } : {}),
    });

    let existingToc: TocTopic[] | undefined;
    if (opts.existingFile) {
      try {
        const existingContent = readFileSync(opts.existingFile, "utf8");
        const parsedToc = parseTocFromMarkdown(existingContent);
        if (parsedToc) {
          existingToc = parsedToc.topics;
          console.log(`Using existing TOC (${existingToc.length} entries, last covered msg ${parsedToc.lastCoveredMsg})`);
        } else {
          console.warn(`Warning: could not parse TOC from ${opts.existingFile} — using full generation`);
        }
      } catch (e) {
        console.warn(`Warning: could not read ${opts.existingFile} — using full generation`);
      }
    }

    const enriched = (opts.toc || opts.tocRecap || opts.topics)
      ? await enrichWithToc(result, buildEnrichmentInput(data as any), "standard", undefined, existingToc)
      : result;

    writeExport(enriched, opts.outputDir);
  } finally {
    if (chromeWasLaunched) {
      shutdownChrome(child);
    }
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
