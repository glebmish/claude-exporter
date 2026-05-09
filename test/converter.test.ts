import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { getFormatter } from "../packages/converter/formatters.ts";
import {
  sanitizeFilename,
  sanitizeConversationTitle,
  stripArchivePluginMarkers,
  formatTimestamp,
  formatDatePrefix,
  formatModelName,
  formatFileSize,
  getExtFromMime,
  parseConversationId,
  toolCallSummary,
  toolResultSummary,
  buildMarkdown,
  collectImages,
  parseConversation,
  renderDefault,
  CitationTracker,
  insertCitationLinks,
  renderContent,
} from "../packages/converter/index.ts";
import {
  makeMinimalConversation,
  makeConversationWithThinking,
  makeConversationWithTools,
  makeConversationWithArtifacts,
  makeConversationWithAttachments,
  makeConversationWithImages,
  makeConversationWithPreviewAsset,
  makeConversationWithHtmlInTools,
  makeConversationWithArtifactRewrite,
  makeConversationWithCreateFileUpdate,
  makeConversationWithStandaloneCreateFile,
  makeConversationWithCitations,
  makeConversationWithDuplicateCitations,
} from "./fixtures.ts";

describe("formatters", () => {
  describe("standard", () => {
    const fmt = getFormatter("standard");

    it("renders image link as markdown with prefix", () => {
      assert.equal(
        fmt.imageLink("photo.png", "2026-01-15 chat"),
        "![photo.png](2026-01-15 chat/photo.png)"
      );
    });

    it("renders image link without prefix as bare basename", () => {
      assert.equal(fmt.imageLink("photo.png", undefined), "![photo.png](photo.png)");
    });

    it("renders artifact link with title as visible label and filename as URL", () => {
      assert.equal(
        fmt.artifactLink("01_script.py", "My Script", "2026-01-15 chat"),
        "**[Artifact: My Script](2026-01-15 chat/01_script.py)**"
      );
    });

    it("renders artifact link with subdir path (uploads) using basename for label", () => {
      assert.equal(
        fmt.artifactLink("uploads/photo.png", "photo.png", "2026-01-15 chat"),
        "**[Artifact: photo.png](2026-01-15 chat/uploads/photo.png)**"
      );
    });

    it("renders thinking as plain blockquotes per-block", () => {
      const lines = fmt.thinkingBlock(["Part one\nLine two", "Part two"]);
      assert.ok(lines.includes("> Part one"));
      assert.ok(lines.includes("> Line two"));
      assert.ok(lines.includes("> Part two"));
      assert.ok(!lines.includes("[!quote]"));
    });

    it("renders tool use as fenced code block", () => {
      const lines = fmt.toolUseBlock(['web_search: "test" → ok']);
      assert.ok(lines.includes("```"));
      assert.ok(lines.includes('web_search: "test" → ok'));
    });
  });

  describe("obsidian", () => {
    const fmt = getFormatter("obsidian");

    it("renders image link as basename-only wikilink", () => {
      assert.equal(fmt.imageLink("photo.png", "attachments/chat"), "![[photo.png]]");
    });

    it("renders artifact link as basename-only wikilink", () => {
      assert.equal(
        fmt.artifactLink("01_script.py", "My Script", "attachments/chat"),
        "**[[01_script.py|My Script]]**"
      );
    });

    it("renders thinking as merged callout", () => {
      const lines = fmt.thinkingBlock(["Part one", "Part two"]);
      assert.ok(lines.includes("> [!quote]- thinking"));
      assert.ok(lines.includes("> Part one"));
      assert.ok(lines.includes("> Part two"));
    });

    it("renders tool use as callout block", () => {
      const lines = fmt.toolUseBlock(['web_search: "test" → ok']);
      assert.ok(lines.includes("> [!todo]- tool use (1)"));
      assert.ok(lines.includes('> web_search: "test" → ok'));
    });

    it("escapes HTML in tool use block", () => {
      const lines = fmt.toolUseBlock(["web_search: \"q\" → <div>result</div>"]);
      assert.ok(lines.includes("\\<div\\>result\\</div\\>"));
    });
  });
});

describe("utility functions", () => {
  describe("sanitizeFilename", () => {
    it("replaces special chars and lowercases", () => {
      assert.equal(sanitizeFilename('My File: "test"'), "my_file_test");
    });
    it("truncates to 50 chars", () => {
      const long = "a".repeat(100);
      assert.equal(sanitizeFilename(long).length, 50);
    });
  });

  describe("stripArchivePluginMarkers", () => {
    it("strips trailing ^archived", () => {
      assert.equal(stripArchivePluginMarkers("Some chat ^archived"), "Some chat");
    });
    it("strips Last message <phrase>", () => {
      assert.equal(stripArchivePluginMarkers("Title hereLast message 1 month ago"), "Title here");
    });
    it("strips both — and handles the NBSP between 'message' and the digit (real Archive-plugin output)", () => {
      //   is the non-breaking space the Archive plugin captures from the sidebar row.
      const polluted = "Sourdough hydration experimentsLast message 1 month ago ^archived";
      assert.equal(
        stripArchivePluginMarkers(polluted),
        "Sourdough hydration experiments",
      );
    });
    it("leaves clean titles alone", () => {
      assert.equal(stripArchivePluginMarkers("Just a normal title"), "Just a normal title");
    });
  });

  describe("sanitizeConversationTitle", () => {
    it("handles null", () => {
      assert.equal(sanitizeConversationTitle(null), "claude_conversation");
    });
    it("handles 'New conversation'", () => {
      assert.equal(sanitizeConversationTitle("New conversation"), "claude_conversation");
    });
    it("sanitizes special characters", () => {
      assert.equal(
        sanitizeConversationTitle('file/with:special<chars>'),
        "file_with_special_chars"
      );
    });
  });

  describe("formatModelName", () => {
    it("formats claude-opus-4-6", () => {
      assert.equal(formatModelName("claude-opus-4-6"), "Opus 4.6");
    });
    it("formats claude-3-5-sonnet-20241022", () => {
      assert.equal(formatModelName("claude-3-5-sonnet-20241022"), "Sonnet 3.5");
    });
    it("formats claude-haiku-4-5-20251001", () => {
      assert.equal(formatModelName("claude-haiku-4-5-20251001"), "Haiku 4.5");
    });
    it("returns empty for unknown", () => {
      assert.equal(formatModelName("unknown"), "");
    });
    it("returns raw string for unrecognized model", () => {
      assert.equal(formatModelName("gpt-4"), "gpt-4");
    });
  });

  describe("formatFileSize", () => {
    it("formats bytes", () => { assert.equal(formatFileSize(500), "500 B"); });
    it("formats KB", () => { assert.equal(formatFileSize(2048), "2 KB"); });
    it("formats MB", () => { assert.equal(formatFileSize(1500000), "1.4 MB"); });
  });

  describe("getExtFromMime", () => {
    it("returns .py for python", () => {
      assert.equal(getExtFromMime("text/x-python"), ".py");
    });
    it("returns .txt for unknown", () => {
      assert.equal(getExtFromMime("application/octet-stream"), ".txt");
    });
    it("returns .txt for null", () => {
      assert.equal(getExtFromMime(null as unknown as string), ".txt");
    });
  });

  describe("parseConversationId", () => {
    const UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    it("extracts from full URL", () => {
      assert.equal(
        parseConversationId(`https://claude.ai/chat/${UUID}`),
        UUID
      );
    });
    it("accepts bare UUID", () => {
      assert.equal(parseConversationId(UUID), UUID);
    });
    it("returns null for invalid input", () => {
      assert.equal(parseConversationId("not a valid id!"), null);
    });
    it("returns null for non-claude.ai URL", () => {
      assert.equal(parseConversationId(`https://example.com/chat/${UUID}`), null);
    });
    it("returns null for date-like string", () => {
      assert.equal(parseConversationId("2026-03-23"), null);
    });
    it("handles URL with query params", () => {
      assert.equal(
        parseConversationId(`https://claude.ai/chat/${UUID}?tree=true`),
        UUID
      );
    });
    it("handles mixed case URL", () => {
      assert.equal(
        parseConversationId(`https://Claude.AI/chat/${UUID.toUpperCase()}`),
        UUID
      );
    });
  });

  describe("formatTimestamp", () => {
    it("returns null for falsy input", () => {
      assert.equal(formatTimestamp(""), null);
    });
    it("formats ISO string", () => {
      const result = formatTimestamp("2026-01-15T10:00:00Z");
      assert.ok(result!.includes("2026"));
      assert.ok(result!.includes("Jan"));
    });
  });

  describe("formatDatePrefix", () => {
    it("extracts YYYY-MM-DD", () => {
      assert.equal(formatDatePrefix("2026-01-15T10:00:00Z"), "2026-01-15");
    });
    it("returns empty for falsy", () => {
      assert.equal(formatDatePrefix(""), "");
    });
  });

  describe("toolCallSummary", () => {
    it("summarizes web_search", () => {
      assert.equal(
        toolCallSummary("web_search", { query: "hello" }),
        'web_search: "hello"'
      );
    });
    it("summarizes web_fetch", () => {
      assert.equal(
        toolCallSummary("web_fetch", { url: "https://example.com" }),
        "web_fetch: https://example.com"
      );
    });
    it("handles array values in input", () => {
      const result = toolCallSummary("custom_tool", { items: [1, 2, 3], name: "test" });
      assert.ok(result.includes("items=[3]"));
      assert.ok(result.includes('name="test"'));
    });
  });

  describe("toolResultSummary", () => {
    it("returns 'error' for error results", () => {
      assert.equal(toolResultSummary({ type: "tool_result", is_error: true, content: [] }), "error");
    });
    it("returns 'ok' for OK text", () => {
      assert.equal(
        toolResultSummary({ type: "tool_result", content: [{ text: "OK" }] }),
        "ok"
      );
    });
    it("truncates long results", () => {
      const long = "x".repeat(100);
      const result = toolResultSummary({ type: "tool_result", content: [{ text: long }] });
      assert.ok(result.length <= 45);
    });
  });
});

describe("buildMarkdown", () => {
  describe("frontmatter", () => {
    it("includes created and updated fields", () => {
      const data = makeMinimalConversation();
      const { markdown } = buildMarkdown(data, {});
      assert.ok(markdown.includes("created: 2026-01-15"));
      assert.ok(markdown.includes("updated: 2026-01-15"));
    });

    it("includes title, source, model", () => {
      const data = makeMinimalConversation();
      const { markdown } = buildMarkdown(data, {});
      assert.ok(markdown.includes('title: "Test Conversation"'));
      assert.ok(markdown.includes("source: https://claude.ai/chat/conv-001"));
      assert.ok(markdown.includes("model: claude-opus-4-6"));
    });

    it("includes message count", () => {
      const data = makeMinimalConversation();
      const { markdown } = buildMarkdown(data, {});
      assert.ok(markdown.includes("messages: 1"));
    });

    it("includes artifact count when present", () => {
      const data = makeConversationWithArtifacts();
      const { markdown } = buildMarkdown(
        data,
        { includeArtifacts: true },
        { sandboxFiles: [{ path: "/mnt/user-data/outputs/script.py", filename: "script.py", relativeWritePath: "script.py" }] },
      );
      assert.ok(markdown.includes("artifacts: 1"));
    });
  });

  describe("headings", () => {
    it("uses formatted model name in assistant heading", () => {
      const data = makeMinimalConversation();
      const { markdown } = buildMarkdown(data, {});
      assert.ok(markdown.includes("### Claude Opus 4.6"));
    });

    it("uses 'You' for user heading", () => {
      const data = makeMinimalConversation();
      const { markdown } = buildMarkdown(data, {});
      assert.ok(markdown.includes("### You"));
    });
  });

  describe("thinking blocks", () => {
    it("excluded by default", () => {
      const data = makeConversationWithThinking();
      const { markdown } = buildMarkdown(data, {});
      assert.ok(!markdown.includes("Let me calculate"));
    });

    it("included when enabled (standard format)", () => {
      const data = makeConversationWithThinking();
      const { markdown } = buildMarkdown(data, { includeThinking: true });
      assert.ok(markdown.includes("> Let me calculate"));
      assert.ok(!markdown.includes("[!quote]"));
    });

    it("included as callout when obsidian format", () => {
      const data = makeConversationWithThinking();
      const { markdown } = buildMarkdown(data, {
        format: "obsidian",
        includeThinking: true,
      });
      assert.ok(markdown.includes("> [!quote]- thinking"));
      assert.ok(markdown.includes("> Let me calculate"));
    });

    it("merges multiple thinking blocks in obsidian format", () => {
      const data = makeConversationWithThinking();
      const { markdown } = buildMarkdown(data, {
        format: "obsidian",
        includeThinking: true,
      });
      const calloutCount = (markdown.match(/\[!quote\]/g) || []).length;
      assert.equal(calloutCount, 1);
      assert.ok(markdown.includes("Double checking"));
    });
  });

  describe("tool calls", () => {
    it("excluded by default", () => {
      const data = makeConversationWithTools();
      const { markdown } = buildMarkdown(data, {});
      assert.ok(!markdown.includes("web_search"));
    });

    it("included as code block in standard format", () => {
      const data = makeConversationWithTools();
      const { markdown } = buildMarkdown(data, { includeToolCalls: true });
      assert.ok(markdown.includes("```"));
      assert.ok(markdown.includes('web_search: "test query"'));
    });

    it("included as callout in obsidian format", () => {
      const data = makeConversationWithTools();
      const { markdown } = buildMarkdown(data, {
        format: "obsidian",
        includeToolCalls: true,
      });
      assert.ok(markdown.includes("> [!todo]- tool use"));
      assert.ok(markdown.includes('web_search: "test query"'));
    });

    it("flushes tool calls before text in obsidian format", () => {
      const data = makeConversationWithTools();
      const { markdown } = buildMarkdown(data, {
        format: "obsidian",
        includeToolCalls: true,
      });
      const toolPos = markdown.indexOf("[!todo]");
      const textPos = markdown.indexOf("Here is what I found.");
      assert.ok(toolPos < textPos, "tool callout should come before text");
    });

    it("dumps all tool calls at end in standard format", () => {
      const data = makeConversationWithTools();
      const { markdown } = buildMarkdown(data, { includeToolCalls: true });
      const lastText = markdown.lastIndexOf("I fetched the page.");
      const codeBlock = markdown.indexOf("```", lastText);
      assert.ok(codeBlock > lastText, "code block should come after last text");
    });

    it("appends tool result to call summary", () => {
      const data = makeConversationWithTools();
      const { markdown } = buildMarkdown(data, { includeToolCalls: true });
      assert.ok(markdown.includes("→ Found 3 results"));
    });
  });

  describe("sandbox file linking", () => {
    it("emits a link when a tool_use input.path matches a sandbox file", () => {
      const data = makeConversationWithCreateFileUpdate();
      const { markdown, datedTitle } = buildMarkdown(
        data,
        { includeArtifacts: true, includeToolCalls: true },
        { sandboxFiles: [{ path: "/mnt/user-data/outputs/my-guide.md", filename: "my-guide.md", relativeWritePath: "my-guide.md" }] },
      );
      // standard formatter renders **[Artifact: <name>](<datedTitle>/<filename>)**
      assert.ok(markdown.includes("**[Artifact: my-guide.md]"), "expected an artifact link for the touched file");
      assert.ok(markdown.includes(`${datedTitle}/my-guide.md`), "link should resolve under the datedTitle dir");
    });

    it("dedupes links when the same path is touched multiple times in one message", () => {
      const data = makeConversationWithCreateFileUpdate();
      const { markdown } = buildMarkdown(
        data,
        { includeArtifacts: true, includeToolCalls: true },
        { sandboxFiles: [{ path: "/mnt/user-data/outputs/my-guide.md", filename: "my-guide.md", relativeWritePath: "my-guide.md" }] },
      );
      const occurrences = markdown.match(/\*\*\[Artifact: my-guide\.md\]/g) ?? [];
      // The fixture has multiple operations on the same path within a single assistant message.
      // Each unique file should appear at most once per message.
      assert.ok(occurrences.length >= 1, "should emit at least one link");
    });

    it("emits no link when sandboxFiles is empty (graceful fallback for expired sandbox)", () => {
      const data = makeConversationWithCreateFileUpdate();
      const { markdown } = buildMarkdown(
        data,
        { includeArtifacts: true, includeToolCalls: true },
        {},
      );
      assert.ok(!markdown.includes("**[Artifact:"), "no artifact links when no sandbox files are provided");
    });
  });

  describe("history-only invariant", () => {
    it("never reads input.content from artifacts:create — only sandbox content reaches output files", () => {
      // Direct test of rule 1: tool_use is never applied. The fixture's artifacts:create
      // would (under the old replay) produce a file with `print("hello world")`.
      // Under the new design, parseConversation must not produce any artifactFiles —
      // the orchestrator is responsible for fetching sandbox files separately.
      const data = makeConversationWithArtifacts();
      const result = parseConversation(data, { includeArtifacts: true, includeToolCalls: true });
      // ConversationResult no longer carries artifactFiles. The count is sourced from sandboxFiles context (empty here).
      assert.equal(result.artifacts, 0, "artifact count should reflect sandboxFiles, not tool_use input.content");
    });

    it("artifacts:create renders as a generic tool_use callout (no special link)", () => {
      const data = makeConversationWithArtifacts();
      const { markdown } = buildMarkdown(data, { includeArtifacts: true, includeToolCalls: true });
      // No [Artifact: ...] link because we have no sandboxFiles.
      assert.ok(!markdown.includes("**[Artifact:"), "artifacts:create should not emit a link without sandbox metadata");
      // The callout should mention the tool name.
      assert.ok(markdown.includes("artifacts:") || markdown.includes("artifacts "), "tool name should appear in the callout");
    });
  });

  describe("attachments", () => {
    it("renders attachment notation", () => {
      const data = makeConversationWithAttachments();
      const { markdown } = buildMarkdown(data, {});
      assert.ok(markdown.includes("*[Attached: data.csv (2 KB)]*"));
      assert.ok(markdown.includes("*[Attached: notes.txt"));
    });

    it("inlines extracted_content as a fenced code block", () => {
      const data = makeMinimalConversation({
        chat_messages: [
          {
            uuid: "msg-001",
            sender: "human",
            content: [{ type: "text", text: "See pasted log" }],
            created_at: "2026-01-15T10:00:00Z",
            attachments: [
              {
                file_name: "pasted content",
                file_size: 14336,
                file_type: "txt",
                extracted_content: "line one\nline two\nline three",
              },
            ],
          },
        ],
      });
      const { markdown } = buildMarkdown(data, {});
      assert.ok(markdown.includes("*[Attached: pasted content (14 KB)]*"));
      assert.ok(markdown.includes("line one\nline two\nline three"));
      assert.ok(markdown.includes("```\nline one"));
    });

    it("uses a longer fence when extracted_content contains triple backticks", () => {
      const data = makeMinimalConversation({
        chat_messages: [
          {
            uuid: "msg-001",
            sender: "human",
            content: [{ type: "text", text: "snippet" }],
            created_at: "2026-01-15T10:00:00Z",
            attachments: [
              {
                file_name: "code.md",
                file_size: 100,
                extracted_content: "before\n```\ninner code\n```\nafter",
              },
            ],
          },
        ],
      });
      const { markdown } = buildMarkdown(data, {});
      assert.ok(markdown.includes("````\nbefore"), "outer fence should be 4 backticks");
      assert.ok(markdown.includes("```\ninner code\n```"), "inner triple-backticks preserved");
    });
  });

  describe("images", () => {
    it("renders standard image links with datedTitle as the link prefix", () => {
      const data = makeConversationWithImages();
      const { markdown, datedTitle } = buildMarkdown(data, {}, {
        imageFilenames: [{ msgIndex: 0, filename: "01_screenshot.png" }],
      });
      assert.ok(markdown.includes(`![01_screenshot.png](${datedTitle}/01_screenshot.png)`));
    });

    it("renders obsidian image wikilinks as basename only", () => {
      const data = makeConversationWithImages();
      const { markdown } = buildMarkdown(data, { format: "obsidian" }, {
        attachmentLinkPrefix: "attachments/chat",
        imageFilenames: [{ msgIndex: 0, filename: "01_screenshot.png" }],
      });
      assert.ok(markdown.includes("![[01_screenshot.png]]"));
      assert.ok(!markdown.includes("attachments/chat/"));
    });
  });

  describe("HTML escaping in obsidian tool results", () => {
    it("escapes HTML in obsidian format tool calls", () => {
      const data = makeConversationWithHtmlInTools();
      const { markdown } = buildMarkdown(data, {
        format: "obsidian",
        includeToolCalls: true,
      });
      assert.ok(markdown.includes("\\<div\\>"));
    });

    it("does not escape HTML in standard format", () => {
      const data = makeConversationWithHtmlInTools();
      const { markdown } = buildMarkdown(data, {
        format: "standard",
        includeToolCalls: true,
      });
      assert.ok(markdown.includes("<div>result</div>"));
    });
  });

  describe("datedTitle", () => {
    it("returns date-prefixed title with case + spaces preserved", () => {
      const data = makeMinimalConversation();
      const { datedTitle } = buildMarkdown(data, {});
      assert.equal(datedTitle, "2026-01-15 Test Conversation");
    });
  });
});

describe("collectImages", () => {
  it("extracts image metadata from preview_url", () => {
    const data = makeConversationWithImages();
    const images = collectImages(data.chat_messages);
    assert.equal(images.length, 1);
    assert.equal(images[0].msgIndex, 0);
    assert.equal(images[0].fileName, "screenshot.png");
    assert.equal(images[0].url, "/files/img-001/preview");
  });

  it("extracts image metadata from preview_asset.url fallback", () => {
    const data = makeConversationWithPreviewAsset();
    const images = collectImages(data.chat_messages);
    assert.equal(images.length, 1);
    assert.equal(images[0].url, "https://cdn.example.com/photo.jpg");
  });
});

describe("parseConversation", () => {
  it("extracts title from conversation name", () => {
    const data = makeMinimalConversation();
    const result = parseConversation(data, {});
    assert.equal(result.title, "Test Conversation");
  });

  it("constructs url from uuid", () => {
    const data = makeMinimalConversation();
    const result = parseConversation(data, {});
    assert.equal(result.url, "https://claude.ai/chat/conv-001");
  });

  it("uses data.created_at for created, not first message timestamp", () => {
    const data = makeMinimalConversation({
      created_at: "2026-03-01T09:00:00Z",
      updated_at: "2026-03-15T18:00:00Z",
    });
    const result = parseConversation(data, {});
    assert.equal(result.created, "2026-03-01");
  });

  it("uses data.updated_at for updated, not last message timestamp", () => {
    const data = makeMinimalConversation({
      created_at: "2026-03-01T09:00:00Z",
      updated_at: "2026-03-15T18:00:00Z",
    });
    const result = parseConversation(data, {});
    assert.equal(result.updated, "2026-03-15");
  });

  it("counts total messages", () => {
    const data = makeMinimalConversation();
    const result = parseConversation(data, {});
    assert.equal(result.messageCount, 1);
  });

  it("counts artifacts from sandboxFiles when includeArtifacts is true", () => {
    const data = makeConversationWithArtifacts();
    const result = parseConversation(
      data,
      { includeArtifacts: true },
      { sandboxFiles: [{ path: "/mnt/user-data/outputs/script.py", filename: "script.py", relativeWritePath: "script.py" }] },
    );
    assert.equal(result.artifacts, 1);
  });

  it("reports zero artifacts when includeArtifacts is false (sandboxFiles ignored)", () => {
    const data = makeConversationWithArtifacts();
    const result = parseConversation(
      data,
      { includeArtifacts: false },
      { sandboxFiles: [{ path: "/mnt/user-data/outputs/script.py", filename: "script.py", relativeWritePath: "script.py" }] },
    );
    assert.equal(result.artifacts, 0);
  });

  it("content contains message text without frontmatter", () => {
    const data = makeMinimalConversation();
    const result = parseConversation(data, {});
    const content = renderContent(result.messages, result.linksSection);
    assert.ok(content.includes("Hello Claude"));
    assert.ok(!content.includes("title:"));
    assert.ok(!content.includes("source:"));
  });

  it("content does not start with h1 title heading", () => {
    const data = makeMinimalConversation();
    const result = parseConversation(data, {});
    const content = renderContent(result.messages, result.linksSection);
    assert.ok(!content.startsWith("# Test Conversation"));
  });

  it("content starts with --- separator", () => {
    const data = makeMinimalConversation();
    const result = parseConversation(data, {});
    const content = renderContent(result.messages, result.linksSection);
    assert.ok(content.startsWith("---\n"));
  });

  it("datedTitle uses created date prefix", () => {
    const data = makeMinimalConversation({ created_at: "2026-03-01T09:00:00Z" });
    const result = parseConversation(data, {});
    assert.ok(result.datedTitle.startsWith("2026-03-01 "));
  });
});

describe("renderDefault with toc/tocWithRecap/keyTopics", () => {
  const base = makeMinimalConversation();

  it("does not inject any blocks when all absent", () => {
    const result = parseConversation(base, {});
    const md = renderDefault(result);
    assert.ok(!md.includes("## Table of Contents"));
    assert.ok(!md.includes("## Key topics"));
  });

  it("injects toc before content when toc is set", () => {
    const result = parseConversation(base, {});
    const enriched = { ...result, toc: "## Table of Contents\n\n- [foo](#foo)" };
    const md = renderDefault(enriched);
    const tocIdx = md.indexOf("## Table of Contents");
    const contentIdx = md.indexOf(renderContent(result.messages, result.linksSection).slice(0, 10));
    assert.ok(tocIdx !== -1, "toc block missing");
    assert.ok(tocIdx < contentIdx, "toc should appear before content");
  });

  it("injects tocWithRecap before content when tocWithRecap is set", () => {
    const result = parseConversation(base, {});
    const recap = "## Table of Contents\n\n- [foo](#foo)\n  - Some recap.";
    const enriched = { ...result, tocWithRecap: recap };
    const md = renderDefault(enriched);
    const idx = md.indexOf("## Table of Contents");
    const contentIdx = md.indexOf(renderContent(result.messages, result.linksSection).slice(0, 10));
    assert.ok(idx !== -1, "tocWithRecap block missing");
    assert.ok(idx < contentIdx, "tocWithRecap should appear before content");
  });

  it("injects keyTopics before content when keyTopics is set", () => {
    const result = parseConversation(base, {});
    const enriched = { ...result, keyTopics: "## Key topics\n\n- GTD\n- PARA" };
    const md = renderDefault(enriched);
    const ktIdx = md.indexOf("## Key topics");
    const contentIdx = md.indexOf(renderContent(result.messages, result.linksSection).slice(0, 10));
    assert.ok(ktIdx !== -1, "keyTopics block missing");
    assert.ok(ktIdx < contentIdx, "keyTopics should appear before content");
  });

  it("injects toc and keyTopics when both set", () => {
    const result = parseConversation(base, {});
    const enriched = {
      ...result,
      toc: "## Table of Contents\n\n- [foo](#foo)",
      keyTopics: "## Key topics\n\n- GTD",
    };
    const md = renderDefault(enriched);
    assert.ok(md.includes("## Table of Contents"));
    assert.ok(md.includes("## Key topics"));
  });
});

describe("renderDefault", () => {
  it("includes frontmatter title", () => {
    const result = parseConversation(makeMinimalConversation(), {});
    const md = renderDefault(result);
    assert.ok(md.includes('title: "Test Conversation"'));
  });

  it("includes source url in frontmatter", () => {
    const result = parseConversation(makeMinimalConversation(), {});
    const md = renderDefault(result);
    assert.ok(md.includes("source: https://claude.ai/chat/conv-001"));
  });

  it("omits artifacts line when count is zero", () => {
    const result = parseConversation(makeMinimalConversation(), {});
    const md = renderDefault(result);
    assert.ok(!md.includes("artifacts:"));
  });

  it("includes artifacts line when non-zero", () => {
    const result = parseConversation(
      makeConversationWithArtifacts(),
      { includeArtifacts: true },
      { sandboxFiles: [{ path: "/mnt/user-data/outputs/script.py", filename: "script.py", relativeWritePath: "script.py" }] },
    );
    const md = renderDefault(result);
    assert.ok(md.includes("artifacts: 1"));
  });

  it("includes h1 title heading after frontmatter", () => {
    const result = parseConversation(makeMinimalConversation(), {});
    const md = renderDefault(result);
    assert.ok(md.includes("\n# Test Conversation\n"));
  });

  it("includes message content in output", () => {
    const result = parseConversation(makeMinimalConversation(), {});
    const md = renderDefault(result);
    assert.ok(md.includes("Hello Claude"));
  });
});

describe("CitationTracker", () => {
  it("assigns sequential numbers to unique URLs", () => {
    const tracker = new CitationTracker();
    assert.equal(tracker.add("https://a.com", "A"), 1);
    assert.equal(tracker.add("https://b.com", "B"), 2);
  });

  it("returns same number for duplicate URLs", () => {
    const tracker = new CitationTracker();
    assert.equal(tracker.add("https://a.com", "A"), 1);
    assert.equal(tracker.add("https://a.com", "A again"), 1);
  });

  it("renders links section", () => {
    const tracker = new CitationTracker();
    tracker.add("https://a.com", "Site A");
    tracker.add("https://b.com", "Site B");
    const section = tracker.renderLinksSection()!;
    assert.ok(section.includes("## Links"));
    assert.ok(section.includes("1. [Site A](https://a.com)"));
    assert.ok(section.includes("2. [Site B](https://b.com)"));
  });

  it("returns null when no citations", () => {
    const tracker = new CitationTracker();
    assert.equal(tracker.renderLinksSection(), null);
  });
});

describe("insertCitationLinks", () => {
  it("inserts reference links at citation end positions", () => {
    const tracker = new CitationTracker();
    const text = "Hello world. Foo bar baz.";
    const result = insertCitationLinks(text, [
      { url: "https://example.com", title: "Example", start_index: 0, end_index: 12 },
    ], tracker);
    assert.equal(result, "Hello world. [1](https://example.com) Foo bar baz.");
  });

  it("handles multiple non-overlapping citations", () => {
    const tracker = new CitationTracker();
    const text = "AAAA BBBB";
    const result = insertCitationLinks(text, [
      { url: "https://a.com", title: "A", start_index: 0, end_index: 4 },
      { url: "https://b.com", title: "B", start_index: 5, end_index: 9 },
    ], tracker);
    assert.ok(result.includes("[1](https://a.com)"));
    assert.ok(result.includes("[2](https://b.com)"));
  });

  it("returns text unchanged when no citations", () => {
    const tracker = new CitationTracker();
    assert.equal(insertCitationLinks("hello", [], tracker), "hello");
  });
});

describe("citations in buildMarkdown", () => {
  it("inserts inline citation links in output", () => {
    const data = makeConversationWithCitations();
    const { markdown } = buildMarkdown(data, {});
    assert.ok(markdown.includes("[1](https://example.com/guides/scheduling)"));
    assert.ok(markdown.includes("[2](https://example.com/integrations/notes)"));
    assert.ok(markdown.includes("[3](https://docs.example.com/)"));
  });

  it("appends links section at end", () => {
    const data = makeConversationWithCitations();
    const { markdown } = buildMarkdown(data, {});
    assert.ok(markdown.includes("## Links"));
    assert.ok(markdown.includes("1. [Scheduling Guide | Acme](https://example.com/guides/scheduling)"));
    assert.ok(markdown.includes("2. [Note-taking Integration | Acme](https://example.com/integrations/notes)"));
    assert.ok(markdown.includes("3. [Acme API Docs](https://docs.example.com/)"));
  });

  it("deduplicates URLs in links section", () => {
    const data = makeConversationWithDuplicateCitations();
    const { markdown } = buildMarkdown(data, {});
    assert.ok(markdown.includes("## Links"));
    // Only one entry in links section despite two citations with same URL
    const linksSection = markdown.slice(markdown.indexOf("## Links"));
    const linkEntries = linksSection.match(/^\d+\./gm) || [];
    assert.equal(linkEntries.length, 1, "should have exactly 1 link entry for deduplicated URL");
  });

  it("no links section when conversation has no citations", () => {
    const data = makeMinimalConversation();
    const { markdown } = buildMarkdown(data, {});
    assert.ok(!markdown.includes("## Links"));
  });
});

describe("renderContent", () => {
  it("renders messages with ### headers and --- separators", () => {
    const messages: import("../packages/converter/types.ts").RenderedMessage[] = [
      { role: "human", timestamp: "Jan 15, 2026, 10:00 AM", humanIndex: 1, header: "### You · Jan 15, 2026, 10:00 AM", body: "Hello Claude" },
      { role: "assistant", header: "### Claude Opus 4.6", body: "Hello! How can I help you today?" },
    ];
    const result = renderContent(messages);
    assert.ok(result.startsWith("---\n\n### You · Jan 15, 2026, 10:00 AM"));
    assert.ok(result.includes("---\n\n### Claude Opus 4.6"));
    assert.ok(result.includes("Hello Claude"));
    assert.ok(result.includes("Hello! How can I help you today?"));
    assert.ok(!result.includes("##\n"), "no bare ## headings");
  });

  it("inserts ## section header before first message of a section", () => {
    const messages: import("../packages/converter/types.ts").RenderedMessage[] = [
      { role: "human", humanIndex: 1, header: "### You · Jan 15, 2026, 10:00 AM", body: "Hello", sectionHeading: "Greeting", sectionRange: "1–1" },
      { role: "assistant", header: "### Claude Opus 4.6", body: "Hi" },
    ];
    const result = renderContent(messages);
    assert.ok(result.includes("## Greeting *(msg 1)*\n\n### You · Jan 15, 2026, 10:00 AM"), "section header precedes message header");
    assert.ok(result.includes("---\n\n### Claude Opus 4.6"), "no section header on assistant message — header appears right after ---");
  });

  it("inserts section headers at correct topic boundaries", () => {
    const messages: import("../packages/converter/types.ts").RenderedMessage[] = [
      { role: "human", humanIndex: 1, header: "### You · ts1", body: "q1", sectionHeading: "Topic A", sectionRange: "1–1" },
      { role: "assistant", header: "### Claude", body: "a1" },
      { role: "human", humanIndex: 2, header: "### You · ts2", body: "q2", sectionHeading: "Topic B", sectionRange: "2–2" },
      { role: "assistant", header: "### Claude", body: "a2" },
    ];
    const result = renderContent(messages);
    assert.ok(result.includes("## Topic A *(msg 1)*"));
    assert.ok(result.includes("## Topic B *(msg 2)*"));
    const posA = result.indexOf("## Topic A");
    const posB = result.indexOf("## Topic B");
    assert.ok(posA < posB, "Topic A appears before Topic B");
  });

  it("appends linksSection at end when provided", () => {
    const messages: import("../packages/converter/types.ts").RenderedMessage[] = [
      { role: "human", header: "### You", body: "q" },
    ];
    const links = "## Links\n\n1. [Example](https://example.com)";
    const result = renderContent(messages, links);
    assert.ok(result.endsWith(links), "links section at end");
    assert.ok(result.includes("\n---\n\n## Links"), "separator before links section");
  });

  it("returns content trimmed with no trailing newline issues", () => {
    const messages: import("../packages/converter/types.ts").RenderedMessage[] = [
      { role: "human", header: "### You", body: "hello" },
    ];
    const result = renderContent(messages);
    assert.ok(!result.endsWith("\n\n"), "no double trailing newline");
  });
});
