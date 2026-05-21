import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { runExport, StageError } from "../packages/orchestrator/index.ts";
import { InMemoryFs } from "./helpers/in-memory-fs.ts";
import { makeStubCdp } from "./helpers/stub-cdp.ts";

const baseConversation = {
  uuid: "abc-123",
  name: "Test Chat",
  model: "claude-opus-4-6",
  created_at: "2026-01-15T10:00:00Z",
  updated_at: "2026-01-15T10:00:00Z",
  chat_messages: [
    {
      uuid: "m1",
      sender: "human" as const,
      content: [{ type: "text", text: "Hello" }],
      created_at: "2026-01-15T10:00:00Z",
    },
    {
      uuid: "m2",
      sender: "assistant" as const,
      content: [{ type: "text", text: "Hi there" }],
      created_at: "2026-01-15T10:00:01Z",
    },
  ],
};

const baseOpts = {
  conversationId: "abc-123",
  outputDir: "out",
  format: "standard" as const,
  includeArtifacts: true,
  includeThinking: false,
  includeToolCalls: false,
  includeImages: true,
  toc: false,
  tocRecap: false,
  topics: false,
  patchInProgress: false,
};

describe("runExport — usage validation", () => {
  it("throws a StageError(usage) when chatName and chatNameTemplate are both set", async () => {
    const fs = new InMemoryFs();
    const cdp = makeStubCdp({ conversation: baseConversation });
    await assert.rejects(
      runExport({ ...baseOpts, chatName: "x", chatNameTemplate: "y" }, { fs, cdpOverride: cdp }),
      (e: unknown) => e instanceof StageError && e.stage === "usage",
    );
  });

  it("throws a StageError(usage) when patchInProgress lacks an existing-file pointer", async () => {
    const fs = new InMemoryFs();
    const cdp = makeStubCdp({ conversation: baseConversation });
    await assert.rejects(
      runExport({ ...baseOpts, patchInProgress: true }, { fs, cdpOverride: cdp }),
      (e: unknown) => e instanceof StageError && e.stage === "usage",
    );
  });
});

describe("runExport — basic export", () => {
  it("case 1: fresh export, no attachments → only the .md is written", async () => {
    const fs = new InMemoryFs();
    const cdp = makeStubCdp({ conversation: baseConversation });
    const result = await runExport(baseOpts, { fs, cdpOverride: cdp });
    assert.equal(result.attachmentsDir, null);
    assert.equal(result.artifactCount, 0);
    assert.equal(result.imageCount, 0);
    const files = fs.list();
    assert.equal(files.length, 1);
    assert.match(files[0], /\.md$/);
    assert.match(files[0], /^out\//);
  });

  it("case 7: chatName literal — no {{var}} substitution", async () => {
    const fs = new InMemoryFs();
    const cdp = makeStubCdp({ conversation: baseConversation });
    const result = await runExport({ ...baseOpts, chatName: "literal-name" }, { fs, cdpOverride: cdp });
    assert.equal(result.datedTitle, "literal-name");
    assert.equal(result.filePath, "out/literal-name.md");
  });

  it("case 8: chatName + chatNameTemplate → throws", async () => {
    const fs = new InMemoryFs();
    const cdp = makeStubCdp({ conversation: baseConversation });
    await assert.rejects(
      () => runExport({ ...baseOpts, chatName: "x", chatNameTemplate: "{{title}}" }, { fs, cdpOverride: cdp }),
      /mutually exclusive/,
    );
  });
});

describe("runExport — attachments layout", () => {
  // Layout fixture: the artifact comes purely from wiggle (the sandbox file
  // below). Real-world research-artifact tool_use blocks (compass_artifact_wf)
  // never overlap with a wiggle file at the same path, so the fixture mirrors
  // a chat where the artifact was created via create_file or similar.
  const conversationWithArtifact = baseConversation;

  const sandboxFiles = [
    {
      path: "/mnt/user-data/outputs/plan.md",
      contentType: "text/markdown",
      text: "# Plan\nbody",
    },
  ];

  it("case 2: attachments → note at <output>/<datedTitle>.md, artifacts flat under <output>/<datedTitle>/", async () => {
    const fs = new InMemoryFs();
    const cdp = makeStubCdp({ conversation: conversationWithArtifact, sandboxFiles });
    const result = await runExport(baseOpts, { fs, cdpOverride: cdp });
    assert.equal(result.artifactCount, 1);
    assert.match(result.filePath, /^out\/.+\.md$/);
    // The note must NOT be nested inside <datedTitle>/
    const noteSegments = result.filePath.split("/");
    assert.equal(noteSegments.length, 2, `expected note at depth 1 under out/, got ${result.filePath}`);
    assert.ok(result.attachmentsDir);
    assert.match(result.attachmentsDir!, /^out\//);
    const files = fs.list();
    // Artifacts live flat directly under the dated-title folder — no artifacts/ subdir
    const artFiles = files.filter((f) => f.startsWith(result.attachmentsDir + "/"));
    assert.equal(artFiles.length, 1);
    assert.ok(!artFiles[0].includes("/artifacts/"), `artifact unexpectedly nested in subdir: ${artFiles[0]}`);
    // Template default is "{{seqNum}} {{title}}"; first H1 is "Plan" → "01 Plan.md"
    assert.ok(artFiles[0].endsWith("/01 Plan.md"), `expected templated 01 Plan.md, got ${artFiles[0]}`);
  });

  it("case 3: --attachments-dir override puts attachments under override", async () => {
    const fs = new InMemoryFs();
    const cdp = makeStubCdp({ conversation: conversationWithArtifact, sandboxFiles });
    const result = await runExport({ ...baseOpts, attachmentsDir: "att" }, { fs, cdpOverride: cdp });
    assert.match(result.filePath, /^out\/.+\.md$/);
    assert.match(result.attachmentsDir!, /^att\//);
    const files = fs.list();
    // Files under att/ are flat (not under att/.../artifacts/) and never under out/
    assert.ok(files.some((f) => f.startsWith("att/") && !f.includes("/artifacts/")));
    assert.ok(!files.some((f) => f.startsWith("out/") && f !== result.filePath));
  });

  it("rule 1: wiggle content wins over tool_use input.content (no replay)", async () => {
    // The fixture's artifacts:create has input.content = "REPLAY_ME". The wiggle stub
    // returns "FROM_WIGGLE" for the same artifact's path. The exported file MUST contain
    // "FROM_WIGGLE" (sandbox state), and "REPLAY_ME" must not appear in either the
    // exported artifact body or the conversation markdown.
    const conversationWithReplayBait = {
      ...baseConversation,
      chat_messages: [
        ...baseConversation.chat_messages,
        {
          uuid: "m4",
          sender: "assistant" as const,
          content: [{
            type: "tool_use",
            name: "create_file",
            input: { path: "/mnt/user-data/outputs/note.md", file_text: "REPLAY_ME — must not appear" },
          }],
          created_at: "2026-01-15T10:00:03Z",
        },
      ],
    };
    const fs = new InMemoryFs();
    const cdp = makeStubCdp({
      conversation: conversationWithReplayBait,
      sandboxFiles: [
        {
          path: "/mnt/user-data/outputs/note.md",
          contentType: "text/markdown",
          text: "# Note\nFROM_WIGGLE — this is the live state",
        },
      ],
    });
    const result = await runExport(baseOpts, { fs, cdpOverride: cdp });
    const artifactFile = fs.list().find((p) => p.endsWith(".md") && p !== result.filePath);
    assert.ok(artifactFile, "expected an exported artifact file");
    const body = (await fs.readText(artifactFile!))!;
    assert.ok(body.includes("FROM_WIGGLE"), "exported artifact must carry wiggle content");
    assert.ok(!body.includes("REPLAY_ME"), "exported artifact must NOT carry tool_use input.content");
    const note = (await fs.readText(result.filePath))!;
    assert.ok(!note.includes("REPLAY_ME — must not"), "conversation markdown must not surface full input.file_text");
  });

  it("research artifact (compass_artifact_wf via artifacts:create) is replayed to a file and linked from the chat note", async () => {
    const conv = {
      ...baseConversation,
      chat_messages: [
        ...baseConversation.chat_messages,
        {
          uuid: "m_research",
          sender: "assistant" as const,
          content: [
            { type: "text", text: "Here's the report." },
            {
              type: "tool_use",
              name: "artifacts",
              input: {
                id: "compass_artifact_wf-abc123_text/markdown",
                command: "create",
                title: "Hybrid PKM Architecture",
                type: "text/markdown",
                content: "# Hybrid PKM Architecture\n\nFull body of the research report.",
              },
            },
          ],
          created_at: "2026-01-15T10:00:02Z",
        },
      ],
    };
    const fs = new InMemoryFs();
    const cdp = makeStubCdp({ conversation: conv, sandboxFiles: [] });
    const result = await runExport({ ...baseOpts, includeToolCalls: true }, { fs, cdpOverride: cdp });
    // Replayed artifact file exists alongside the note.
    const artifactFile = fs.list().find((p) => p.endsWith(".md") && p !== result.filePath);
    assert.ok(artifactFile, "expected the replayed research artifact to be written as a file");
    const body = (await fs.readText(artifactFile!))!;
    assert.ok(body.includes("Full body of the research report"));
    // Chat note links to it (standard formatter emits a `[Artifact: …](…)` link).
    const note = (await fs.readText(result.filePath))!;
    const baseName = artifactFile!.split("/").pop()!.replace(/\.md$/, "");
    assert.ok(note.includes(baseName), `chat note must link to the artifact file (${baseName})`);
  });

  it("update/rewrite commands on artifacts produce a warning and are otherwise ignored", async () => {
    const conv = {
      ...baseConversation,
      chat_messages: [
        ...baseConversation.chat_messages,
        {
          uuid: "m_create",
          sender: "assistant" as const,
          content: [{
            type: "tool_use",
            name: "artifacts",
            input: { id: "art-id-1", command: "create", title: "Doc", type: "text/markdown", content: "v1" },
          }],
          created_at: "2026-01-15T10:00:02Z",
        },
        {
          uuid: "m_update",
          sender: "assistant" as const,
          content: [{
            type: "tool_use",
            name: "artifacts",
            input: { id: "art-id-1", command: "update", old_str: "v1", new_str: "v2" },
          }],
          created_at: "2026-01-15T10:00:03Z",
        },
      ],
    };
    const fs = new InMemoryFs();
    const cdp = makeStubCdp({ conversation: conv, sandboxFiles: [] });
    const result = await runExport(baseOpts, { fs, cdpOverride: cdp });
    const artifactFile = fs.list().find((p) => p.endsWith(".md") && p !== result.filePath);
    assert.ok(artifactFile);
    const body = (await fs.readText(artifactFile!))!;
    // Body reflects the create only — the update is ignored.
    assert.ok(body.includes("v1") && !body.includes("v2"));
    assert.ok(
      result.warnings.some((w) => /update.*not supported/i.test(w)),
      `expected an update-not-supported warning, got: ${result.warnings.join(" | ")}`,
    );
  });

  it("uploads land in the uploads/ subdir under the dated-title folder", async () => {
    const fs = new InMemoryFs();
    const cdp = makeStubCdp({
      conversation: conversationWithArtifact,
      sandboxFiles: [
        ...sandboxFiles,
        {
          path: "/mnt/user-data/uploads/photo.png",
          contentType: "image/png",
          base64: Buffer.from("fakebinary").toString("base64"),
          created_at: "2026-01-15T09:59:00Z",
        },
      ],
    });
    await runExport(baseOpts, { fs, cdpOverride: cdp });
    const files = fs.list();
    // upload at <attachmentsDir>/uploads/photo.png
    assert.ok(
      files.some((f) => f.endsWith("/uploads/photo.png")),
      `expected an uploaded file under uploads/, got: ${files.join(", ")}`,
    );
    // artifact still flat (templated name)
    assert.ok(files.some((f) => f.endsWith("/01 Plan.md") && !f.includes("/uploads/")));
  });
});

describe("runExport — template + enrichment", () => {
  it("case 4: --template applies, {{content}} placeholder works", async () => {
    const fs = new InMemoryFs();
    const cdp = makeStubCdp({ conversation: baseConversation });
    const tpl = "# {{title}}\n\n{{content}}\n";
    const result = await runExport({ ...baseOpts, templateText: tpl }, { fs, cdpOverride: cdp });
    const note = fs.read(result.filePath) as string;
    assert.ok(note.startsWith("# Test Chat\n"));
    assert.ok(note.includes("Hello"));
  });

  it("case 5: template-driven flags reuse existing TOC and substitute placeholder", async () => {
    // Caller (CLI / plugin) derives flags from template placeholders before invoking runExport.
    // Here we pass tocRecap:true alongside {{tocWithRecap}} in the template body.
    const fs = new InMemoryFs();
    const cdp = makeStubCdp({ conversation: baseConversation });
    const existingPath = "out/existing.md";
    fs.preset(existingPath, buildExistingMarkdown({
      title: "Test Chat",
      lastCoveredMsg: 2,
      topics: [{ heading: "Greeting", range: "1–2", recap: "exchanged hellos" }],
    }));
    const tpl = "# {{title}}\n\n{{tocWithRecap}}\n\n{{content}}\n";
    const result = await runExport(
      { ...baseOpts, templateText: tpl, existingFilePath: existingPath, tocRecap: true },
      { fs, cdpOverride: cdp },
    );
    assert.equal(result.tocReused, true);
    const note = fs.read(result.filePath) as string;
    assert.ok(!note.includes("{{tocWithRecap}}"));
    assert.ok(note.includes("exchanged hellos"));
  });
});

// Helper: build an existing markdown file with a parseable TOC.
// Format must match what packages/toc/parseTocFromMarkdown expects (standard form).
function buildExistingMarkdown(opts: {
  title: string;
  lastCoveredMsg: number;
  topics: { heading: string; range: string; recap?: string }[];
  keyTopics?: string[];
  exportedDate?: string;
}): string {
  const ex = opts.exportedDate ?? "2026-01-15";
  const lines = [
    "---",
    `title: "${opts.title}"`,
    `source: https://claude.ai/chat/abc-123`,
    `model: claude-opus-4-6`,
    `created: 2026-01-15`,
    `updated: 2026-01-15`,
    `exported: ${ex}`,
    `messages: ${opts.lastCoveredMsg}`,
    "---",
    "",
    `# ${opts.title}`,
    "",
    "## Table of Contents",
    "",
  ];
  for (const t of opts.topics) {
    // Standard form: - [Heading *(msg N)* or *(msgs N–M)*](#anchor)
    const isRange = t.range.includes("–");
    const label = isRange ? `msgs ${t.range}` : `msg ${t.range}`;
    lines.push(`- [${t.heading} *(${label})*](#anchor)`);
    if (t.recap) lines.push(`  - ${t.recap}`);
  }
  lines.push("");
  if (opts.keyTopics) {
    lines.push("## Key topics");
    lines.push("");
    for (const k of opts.keyTopics) lines.push(`- ${k}`);
    lines.push("");
  }
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

describe("runExport — refresh path", () => {
  it("case 11: --existing file unreadable → warning, no previousMessageCount", async () => {
    const fs = new InMemoryFs();
    const cdp = makeStubCdp({ conversation: baseConversation });
    const result = await runExport(
      { ...baseOpts, existingFilePath: "out/missing.md" },
      { fs, cdpOverride: cdp },
    );
    assert.equal(result.previousMessageCount, undefined);
    assert.ok(result.warnings.some((w) => w.includes("not found")));
  });

  it("case 12: --patch-in-progress patches default `exported` key mid-run", async () => {
    const fs = new InMemoryFs();
    const cdp = makeStubCdp({ conversation: baseConversation });
    const existingPath = "out/2026-01-15 Test Chat.md";
    fs.preset(existingPath, buildExistingMarkdown({
      title: "Test Chat",
      lastCoveredMsg: 1,
      topics: [{ heading: "Greeting", range: "1", recap: "" }],
    }));

    let observedMidRun: string | null = null;
    await runExport(
      { ...baseOpts, existingFilePath: existingPath, patchInProgress: true },
      {
        fs, cdpOverride: cdp,
        onStatus: (m) => {
          if (m === "Writing files...") observedMidRun = fs.read(existingPath) as string;
        },
      },
    );
    // The patched-but-not-final state must show "exported: updating"
    assert.ok(observedMidRun !== null);
    assert.ok((observedMidRun as string).includes("exported: updating"));

    // After the run, the final write replaces the file with no "updating" marker
    const final = fs.read(existingPath) as string;
    assert.ok(!final.includes("exported: updating"));
  });

  it("case 13: --patch-in-progress with custom template key", async () => {
    const fs = new InMemoryFs();
    const tpl = "---\nrefreshed: {{exported}}\n---\n# {{title}}\n{{content}}\n";
    const existingPath = "out/2026-01-15 Test Chat.md";
    fs.preset(existingPath, [
      "---",
      `refreshed: 2026-01-10`,
      "---",
      "## Table of Contents",
      "",
      "- [Greeting *(msg 1)*](#anchor)",
      "",
    ].join("\n"));

    let observed: string | null = null;
    const cdp = makeStubCdp({ conversation: baseConversation });
    await runExport(
      { ...baseOpts, existingFilePath: existingPath, patchInProgress: true, templateText: tpl },
      {
        fs, cdpOverride: cdp,
        onStatus: (m) => {
          if (m === "Writing files...") observed = fs.read(existingPath) as string;
        },
      },
    );
    assert.ok(observed !== null && (observed as string).includes("refreshed: updating"));
    const final = fs.read(existingPath) as string;
    assert.match(final, /refreshed: 2026-/);
  });

  it("case 14: stale-attachment cleanup with --existing", async () => {
    const fs = new InMemoryFs();
    const cdp = makeStubCdp({ conversation: baseConversation });
    fs.preset("out/2026-01-15 Test Chat/old-stale.md", "stale");
    fs.preset("out/2026-01-15 Test Chat.md", buildExistingMarkdown({
      title: "Test Chat",
      lastCoveredMsg: 1,
      topics: [{ heading: "Greeting", range: "1" }],
    }));
    await runExport(
      { ...baseOpts, existingFilePath: "out/2026-01-15 Test Chat.md" },
      { fs, cdpOverride: cdp },
    );
    assert.equal(await fs.exists("out/2026-01-15 Test Chat/old-stale.md"), false);
  });

  it("dedupes image upload: prefers sandbox original, links markdown at uploads/<name>", async () => {
    const fs = new InMemoryFs();
    const conversation = {
      ...baseConversation,
      chat_messages: [
        {
          uuid: "m1",
          sender: "human" as const,
          content: [{ type: "text", text: "see photo" }],
          created_at: "2026-01-15T10:00:00Z",
          files: [{
            file_kind: "image",
            file_name: "photo.png",
            preview_url: "https://example.com/preview/photo.png",
          }],
        },
        ...baseConversation.chat_messages,
      ],
    };
    const cdp = makeStubCdp({
      conversation,
      // If the preview path runs, this would produce a written file. We assert
      // it does NOT — the sandbox original is preferred.
      images: { "https://example.com/preview/photo.png": "data:image/png;base64,UFJFVklFVw==" },
      sandboxFiles: [{
        path: "/mnt/user-data/uploads/photo.png",
        contentType: "image/png",
        base64: Buffer.from("ORIGINAL").toString("base64"),
        created_at: "2026-01-15T09:59:00Z",
      }],
    });
    const result = await runExport(baseOpts, { fs, cdpOverride: cdp });

    const files = fs.list();
    assert.ok(
      files.some((f) => f.endsWith("/uploads/photo.png")),
      `expected uploads/photo.png on disk, got: ${files.join(", ")}`,
    );
    assert.ok(
      !files.some((f) => /\/\d{2}_photo\.png$/.test(f)),
      `expected no preview copy (NN_photo.png) on disk, got: ${files.join(", ")}`,
    );
    const note = await fs.readText("out/2026-01-15 Test Chat.md");
    assert.ok(note !== null);
    assert.ok(/uploads\/photo\.png/.test(note), `expected markdown to link uploads/photo.png, got:\n${note}`);
    assert.ok(!/]\(?[^)]*\/\d{2}_photo\.png\)?/.test(note), "expected no NN_photo.png link in markdown");
    assert.equal(result.imageCount, 1, "image should be counted once");
  });

  it("case 15: image fetch returning null is skipped without failure", async () => {
    const fs = new InMemoryFs();
    const conversationWithImage = {
      ...baseConversation,
      chat_messages: [
        {
          uuid: "m1",
          sender: "human" as const,
          content: [{ type: "text", text: "see image" }],
          created_at: "2026-01-15T10:00:00Z",
          files: [{
            file_kind: "image",
            file_name: "img.png",
            preview_url: "https://example.com/img.png",
          }],
        },
      ],
    };
    const cdp = makeStubCdp({ conversation: conversationWithImage });
    const result = await runExport(baseOpts, { fs, cdpOverride: cdp });
    assert.equal(result.imageCount, 0);
  });

  it("case 17: cancellation throws Cancelled", async () => {
    const fs = new InMemoryFs();
    const cdp = makeStubCdp({ conversation: baseConversation });
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(
      () => runExport(baseOpts, { fs, cdpOverride: cdp, signal: ac.signal }),
      /Cancelled/,
    );
  });

  it("validation: --patch-in-progress without --existing throws", async () => {
    const fs = new InMemoryFs();
    const cdp = makeStubCdp({ conversation: baseConversation });
    await assert.rejects(
      () => runExport({ ...baseOpts, patchInProgress: true }, { fs, cdpOverride: cdp }),
      /requires/,
    );
  });

  it("sanitizes malicious upload basenames: no .. segments, no separators, write stays inside attachments dir", async () => {
    const fs = new InMemoryFs();
    const cdp = makeStubCdp({
      conversation: baseConversation,
      sandboxFiles: [{
        path: "/mnt/user-data/uploads/..\\..\\..\\etc\\passwd",
        contentType: "application/octet-stream",
        base64: Buffer.from("MALICIOUS").toString("base64"),
        created_at: "2026-01-15T09:59:00Z",
      }],
    });
    await runExport(baseOpts, { fs, cdpOverride: cdp });

    const files = fs.list();
    const uploadFile = files.find((f) => f.includes("/uploads/"));
    assert.ok(uploadFile, `expected an uploads/<name> file, got: ${files.join(", ")}`);
    const basename = uploadFile!.split("/").pop()!;
    assert.ok(!basename.includes(".."), `basename must not contain ..: ${basename}`);
    assert.ok(!basename.includes("\\"), `basename must not contain \\: ${basename}`);
    assert.ok(!basename.includes("/"), `basename must not contain /: ${basename}`);
    // The whole write path must stay under the chat's attachments dir.
    const attachmentsDir = "out/2026-01-15 Test Chat";
    assert.ok(
      uploadFile!.startsWith(`${attachmentsDir}/`),
      `write path must stay inside ${attachmentsDir}, got: ${uploadFile}`,
    );
  });
});

describe("runExport — flag-gated default rendering", () => {
  // baseConversation has 2 messages; existing fixture covers msgs 1–2 with recap + key topics,
  // so decideEnrichment takes the pure reuseExistingToc path (no AI call).
  function setup() {
    const fs = new InMemoryFs();
    const cdp = makeStubCdp({ conversation: baseConversation });
    const existingPath = "out/existing.md";
    fs.preset(existingPath, buildExistingMarkdown({
      title: "Test Chat",
      lastCoveredMsg: 2,
      topics: [{ heading: "Greeting", range: "1–2", recap: "exchanged hellos" }],
      keyTopics: ["greeting", "small-talk"],
    }));
    return { fs, cdp, existingPath };
  }

  function countOccurrences(text: string, needle: string): number {
    return text.split(needle).length - 1;
  }

  it("no flags + reused enrichment → no TOC and no key-topics sections", async () => {
    const { fs, cdp, existingPath } = setup();
    const result = await runExport(
      { ...baseOpts, existingFilePath: existingPath },
      { fs, cdpOverride: cdp },
    );
    const note = fs.read(result.filePath) as string;
    assert.equal(countOccurrences(note, "## Table of Contents"), 0);
    assert.equal(countOccurrences(note, "## Key topics"), 0);
  });

  it("--toc only → exactly one headers TOC, no recap, no key topics", async () => {
    const { fs, cdp, existingPath } = setup();
    const result = await runExport(
      { ...baseOpts, existingFilePath: existingPath, toc: true },
      { fs, cdpOverride: cdp },
    );
    const note = fs.read(result.filePath) as string;
    assert.equal(countOccurrences(note, "## Table of Contents"), 1);
    assert.equal(countOccurrences(note, "## Key topics"), 0);
    // headers-only TOC has no recap sub-bullet
    assert.ok(!note.includes("exchanged hellos"));
  });

  it("--toc-recap only → exactly one TOC with recap, no key topics, no duplicate", async () => {
    const { fs, cdp, existingPath } = setup();
    const result = await runExport(
      { ...baseOpts, existingFilePath: existingPath, tocRecap: true },
      { fs, cdpOverride: cdp },
    );
    const note = fs.read(result.filePath) as string;
    assert.equal(countOccurrences(note, "## Table of Contents"), 1);
    assert.equal(countOccurrences(note, "## Key topics"), 0);
    assert.ok(note.includes("exchanged hellos"));
  });

  it("--toc + --toc-recap → recap wins, exactly one TOC section", async () => {
    const { fs, cdp, existingPath } = setup();
    const result = await runExport(
      { ...baseOpts, existingFilePath: existingPath, toc: true, tocRecap: true },
      { fs, cdpOverride: cdp },
    );
    const note = fs.read(result.filePath) as string;
    assert.equal(countOccurrences(note, "## Table of Contents"), 1);
    assert.ok(note.includes("exchanged hellos"));
  });

  it("--topics only → no TOC, exactly one key-topics section", async () => {
    const { fs, cdp, existingPath } = setup();
    const result = await runExport(
      { ...baseOpts, existingFilePath: existingPath, topics: true },
      { fs, cdpOverride: cdp },
    );
    const note = fs.read(result.filePath) as string;
    assert.equal(countOccurrences(note, "## Table of Contents"), 0);
    assert.equal(countOccurrences(note, "## Key topics"), 1);
    assert.ok(note.includes("- greeting"));
  });

  it("--toc-recap + --topics → recap TOC + key topics, no duplicate TOC", async () => {
    const { fs, cdp, existingPath } = setup();
    const result = await runExport(
      { ...baseOpts, existingFilePath: existingPath, tocRecap: true, topics: true },
      { fs, cdpOverride: cdp },
    );
    const note = fs.read(result.filePath) as string;
    assert.equal(countOccurrences(note, "## Table of Contents"), 1);
    assert.equal(countOccurrences(note, "## Key topics"), 1);
    assert.ok(note.includes("exchanged hellos"));
    assert.ok(note.includes("- greeting"));
  });

  it("template path is unaffected — placeholders gate field emission, no filtering applied", async () => {
    // Template references only {{tocWithRecap}} — even though enrichment populates
    // toc/keyTopics too, only the recap placeholder should appear in output.
    const { fs, cdp, existingPath } = setup();
    const tpl = "# {{title}}\n\n{{tocWithRecap}}\n\n{{content}}\n";
    const result = await runExport(
      { ...baseOpts, existingFilePath: existingPath, tocRecap: true, templateText: tpl },
      { fs, cdpOverride: cdp },
    );
    const note = fs.read(result.filePath) as string;
    assert.equal(countOccurrences(note, "## Table of Contents"), 1);
    assert.equal(countOccurrences(note, "## Key topics"), 0);
    assert.ok(note.includes("exchanged hellos"));
  });
});

describe("runExport — topics-only reuse (no TOC section in existing file)", () => {
  // Reproduces the regression where a chat exported with a template containing
  // only `{{keyTopicsFlat}}` (no `{{toc}}` / `{{tocWithRecap}}`) was regenerating
  // its enrichment on every refresh, because parseTocFromMarkdown returned null
  // and loadExistingFile bailed out before trying the template-aware key-topics
  // parser. Topics + message count should suffice to skip the agent call.
  it("reuses key topics from a TOC-less existing file when only {{keyTopicsFlat}} is in the template", async () => {
    const fs = new InMemoryFs();
    const tpl = "# {{title}}\n\n- **Messages**: {{messages}}\n- **Topics**: {{keyTopicsFlat}}\n\n{{content}}\n";
    // Hand-crafted existing file: no `## Table of Contents`, just the flat topics line and message count in the body.
    const existingPath = "out/2026-01-15 Test Chat.md";
    fs.preset(existingPath, [
      "---",
      "title: \"Test Chat\"",
      "exported: \"2026-01-15\"",
      "---",
      "# Test Chat",
      "",
      "- **Messages**: 2",
      "- **Topics**: greeting, small-talk",
      "",
      "(body…)",
      "",
    ].join("\n"));
    const cdp = makeStubCdp({
      conversation: baseConversation,
      // If the agent is called, we'd need a mock claude command. Leaving claudePath unset
      // means a regenerate attempt would fail noisily. The point of this test is that we
      // SHOULDN'T regenerate.
    });
    const result = await runExport(
      { ...baseOpts, templateText: tpl, topics: true, existingFilePath: existingPath },
      { fs, cdpOverride: cdp },
    );
    const note = fs.read(result.filePath) as string;
    // Topics line preserved.
    assert.ok(note.includes("greeting, small-talk"), `topics must be reused, got note:\n${note.slice(0, 300)}`);
    // No "enrichment failed" warning — i.e. the agent wasn't called.
    assert.ok(
      !result.warnings.some((w) => /enrichment failed/i.test(w)),
      `topics-only reuse must skip the agent call, got warnings: ${result.warnings.join(" | ")}`,
    );
  });
});

describe("runExport — discoverExistingByDatedTitle", () => {
  it("finds existing file when discover flag is true", async () => {
    const fs = new InMemoryFs();
    const existingPath = "out/2026-01-15 Test Chat.md";
    fs.preset(existingPath, buildExistingMarkdown({
      title: "Test Chat",
      lastCoveredMsg: 1,
      topics: [{ heading: "Greeting", range: "1" }],
    }));
    const cdp = makeStubCdp({ conversation: baseConversation });
    const result = await runExport(
      { ...baseOpts, discoverExistingByDatedTitle: true },
      { fs, cdpOverride: cdp },
    );
    assert.equal(result.previousMessageCount, 1);
  });
});
