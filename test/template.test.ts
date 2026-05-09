import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { applyTemplate } from "../obsidian-plugin/src/template.ts";
import type { ConversationResult } from "../packages/converter/index.ts";

const baseResult: ConversationResult = {
  title: "My Chat",
  url: "https://claude.ai/chat/abc-123",
  model: "claude-opus-4-6",
  created: "2026-01-15",
  updated: "2026-01-20",
  exported: "2026-03-22",
  createdTimestamp: "Jan 15, 2026, 10:00 AM",
  updatedTimestamp: "Jan 20, 2026, 3:00 PM",
  messageCount: 2,
  artifacts: 2,
  messages: [
    {
      role: "human",
      timestamp: "Jan 15, 2026, 10:00 AM",
      humanIndex: 1,
      header: "### You · Jan 15, 2026, 10:00 AM",
      body: "Hello",
    },
    {
      role: "assistant",
      header: "### Claude Opus 4.6",
      body: "Hi",
    },
  ],
  artifactFiles: [],
  datedTitle: "2026-01-15_my_chat",
};

describe("applyTemplate", () => {
  it("substitutes {{title}} variable", () => {
    const result = applyTemplate("# {{title}}\n{{content}}", baseResult);
    assert.ok(result.startsWith("# My Chat\n"));
  });

  it("substitutes all variables in one pass", () => {
    const template = "{{title}} | {{model}} | {{created}} | {{updated}}\n{{content}}";
    const result = applyTemplate(template, baseResult);
    assert.ok(result.startsWith("My Chat | claude-opus-4-6 | 2026-01-15 | 2026-01-20\n"));
  });

  it("substitutes numeric fields as strings", () => {
    const result = applyTemplate("messages: {{messages}}, artifacts: {{artifacts}}\n{{content}}", baseResult);
    assert.ok(result.startsWith("messages: 2, artifacts: 2\n"));
  });

  it("substitutes {{content}} in place", () => {
    const template = "# Header\n\n{{content}}";
    const result = applyTemplate(template, baseResult);
    assert.ok(result.startsWith("# Header\n\n---\n\n### You"), "content starts with separator and ### heading");
    assert.ok(result.includes("Hello"));
  });

  it("appends content after template when {{content}} is absent", () => {
    const template = "# Header\n\ntitle: {{title}}";
    const result = applyTemplate(template, baseResult);
    assert.ok(result.startsWith("# Header\n\ntitle: My Chat"));
    assert.ok(result.includes("---\n\n### You"), "rendered content appended");
  });

  it("leaves unknown variables as-is", () => {
    const result = applyTemplate("{{title}} and {{unknown}}\n{{content}}", baseResult);
    assert.ok(result.startsWith("My Chat and {{unknown}}\n"));
  });

  it("substitutes multiple occurrences of the same variable", () => {
    const result = applyTemplate("{{title}} / {{title}}\n{{content}}", baseResult);
    assert.ok(result.startsWith("My Chat / My Chat\n"));
  });

  it("substitutes {{url}} and {{exported}}", () => {
    const template = "source: {{url}}\nexported: {{exported}}\n{{content}}";
    const result = applyTemplate(template, baseResult);
    assert.ok(result.startsWith("source: https://claude.ai/chat/abc-123\nexported: 2026-03-22\n"));
  });

  it("substitutes {{header}} with title and metadata block", () => {
    const result = applyTemplate("{{header}}\n{{content}}", baseResult);
    assert.ok(result.startsWith("# My Chat\n"));
    assert.ok(result.includes("Jan 15, 2026, 10:00 AM → Jan 20, 2026, 3:00 PM"));
    assert.ok(result.includes("**Messages**: 2"));
    assert.ok(!result.includes("human, "), "no human/assistant breakdown in header");
  });

  it("substitutes {{createdTimestamp}}, {{updatedTimestamp}}", () => {
    const result = applyTemplate("{{createdTimestamp}} → {{updatedTimestamp}}\n{{content}}", baseResult);
    assert.ok(result.startsWith("Jan 15, 2026, 10:00 AM → Jan 20, 2026, 3:00 PM\n"));
  });

  it("leaves {{humanMessages}} and {{assistantMessages}} as-is (removed variables)", () => {
    const result = applyTemplate("{{humanMessages}}/{{assistantMessages}}\n{{content}}", baseResult);
    assert.ok(result.startsWith("{{humanMessages}}/{{assistantMessages}}\n"), "unknown vars left unchanged");
  });

  it("inserts a newline between template body and content when {{content}} is absent and template lacks trailing newline", () => {
    const template = "title: {{title}}";
    const result = applyTemplate(template, baseResult);
    assert.ok(result.startsWith("title: My Chat\n"), `expected newline after template body, got: ${JSON.stringify(result.slice(0, 40))}`);
  });

  it("does not insert an extra newline when template body already ends with one", () => {
    const template = "title: {{title}}\n";
    const result = applyTemplate(template, baseResult);
    assert.ok(!result.startsWith("title: My Chat\n\n\n"), "no double-newline when template already terminates with one");
    assert.ok(result.startsWith("title: My Chat\n"));
  });
});

describe("applyTemplate with toc, tocWithRecap, keyTopics", () => {
  const enrichedResult: ConversationResult = {
    ...baseResult,
    toc: "## Table of Contents\n\n- [[#Setup *(msgs 1\u20131)*|Setup]]",
    tocWithRecap: "## Table of Contents\n\n- [[#Setup *(msgs 1\u20131)*|Setup]]\n  - You asked about setup.",
    keyTopics: "## Key topics\n\n- Setup\n- Config",
  };

  it("substitutes {{toc}}", () => {
    const result = applyTemplate("{{toc}}\n{{content}}", enrichedResult);
    assert.ok(result.startsWith("## Table of Contents"));
    assert.ok(!result.includes("You asked about setup"), "no recap in toc");
  });

  it("substitutes {{tocWithRecap}}", () => {
    const result = applyTemplate("{{tocWithRecap}}\n{{content}}", enrichedResult);
    assert.ok(result.startsWith("## Table of Contents"));
    assert.ok(result.includes("You asked about setup"), "recap present");
  });

  it("substitutes {{keyTopics}}", () => {
    const result = applyTemplate("{{keyTopics}}\n{{content}}", enrichedResult);
    assert.ok(result.startsWith("## Key topics"));
  });

  it("substitutes {{toc}} as empty string when toc absent", () => {
    const result = applyTemplate("{{toc}}\n{{content}}", baseResult);
    assert.ok(result.startsWith("\n"));
  });

  it("substitutes {{tocWithRecap}} as empty string when tocWithRecap absent", () => {
    const result = applyTemplate("{{tocWithRecap}}\n{{content}}", baseResult);
    assert.ok(result.startsWith("\n"));
  });

  it("substitutes {{keyTopics}} as empty string when keyTopics absent", () => {
    const result = applyTemplate("{{keyTopics}}\n{{content}}", baseResult);
    assert.ok(result.startsWith("\n"));
  });
});
