import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  headingToAnchor,
  renderTocBlock,
  renderTocWithRecapBlock,
  renderKeyTopicsBlock,
  applyTopicSections,
  parseTocFromMarkdown,
  parseKeyTopicsFlatFromTemplate,
  buildIncrementalEntries,
} from "../packages/toc/index.ts";
import type { TocTopic, AgentTocEntry } from "../packages/toc/index.ts";
import type { RenderedMessage } from "../packages/converter/index.ts";

const topics = [
  { heading: "GTD and task execution", range: "1–3", recap: "Gleb asked about GTD. Claude explained the methodology." },
  { heading: "PARA critique", range: "4–6", recap: "Gleb critiqued PARA. Claude acknowledged the trade-offs." },
];

describe("headingToAnchor", () => {
  it("lowercases and replaces non-alphanumeric with hyphens", () => {
    const anchor = headingToAnchor("Human · Mar 23, 2026 2:45 PM");
    assert.ok(!anchor.includes("·"), "no middle dot");
    assert.ok(anchor === anchor.toLowerCase(), "lowercase");
    assert.ok(!anchor.startsWith("-"), "no leading hyphen");
    assert.ok(!anchor.endsWith("-"), "no trailing hyphen");
  });

  it("collapses multiple consecutive hyphens to one", () => {
    assert.equal(headingToAnchor("foo---bar"), "foo-bar");
  });

  it("strips leading and trailing hyphens", () => {
    assert.equal(headingToAnchor("·foo·"), "foo");
  });
});

describe("renderTocBlock", () => {
  it("renders obsidian wikilink format", () => {
    const block = renderTocBlock(topics, "obsidian");
    assert.ok(block !== undefined);
    assert.ok(block!.startsWith("## Table of Contents\n\n"));
    assert.ok(block!.includes("[[#GTD and task execution *(msgs 1–3)*]]"));
    assert.ok(block!.includes("[[#PARA critique *(msgs 4–6)*]]"));
    assert.ok(!block!.includes("Gleb asked"), "no recap in toc block");
  });

  it("renders standard markdown link format", () => {
    const block = renderTocBlock(topics, "standard");
    assert.ok(block !== undefined);
    assert.ok(block!.startsWith("## Table of Contents\n\n"));
    assert.ok(block!.includes("[GTD and task execution *(msgs 1–3)*](#gtd"));
    assert.ok(block!.includes("[PARA critique *(msgs 4–6)*](#para"));
    assert.ok(!block!.includes("Gleb asked"), "no recap in toc block");
  });

  it("returns undefined for empty topics array", () => {
    assert.equal(renderTocBlock([], "obsidian"), undefined);
  });
});

describe("renderTocWithRecapBlock", () => {
  it("renders obsidian format with recap sub-bullet", () => {
    const block = renderTocWithRecapBlock(topics, "obsidian");
    assert.ok(block !== undefined);
    assert.ok(block!.startsWith("## Table of Contents\n\n"));
    assert.ok(block!.includes("[[#GTD and task execution *(msgs 1–3)*]]"));
    assert.ok(block!.includes("  - Gleb asked about GTD."), "recap sub-bullet present");
  });

  it("renders standard format with recap sub-bullet", () => {
    const block = renderTocWithRecapBlock(topics, "standard");
    assert.ok(block !== undefined);
    assert.ok(block!.includes("[GTD and task execution *(msgs 1–3)*](#gtd"));
    assert.ok(block!.includes("  - Gleb asked about GTD."), "recap sub-bullet present");
  });

  it("returns undefined for empty topics array", () => {
    assert.equal(renderTocWithRecapBlock([], "obsidian"), undefined);
  });
});

describe("renderKeyTopicsBlock", () => {
  it("renders each keyword as its own bullet", () => {
    const block = renderKeyTopicsBlock(["GTD", "PARA"]);
    assert.ok(block !== undefined);
    assert.ok(block!.startsWith("## Key topics\n\n"));
    assert.ok(block!.includes("- GTD"));
    assert.ok(block!.includes("- PARA"));
  });

  it("returns undefined for empty array", () => {
    assert.equal(renderKeyTopicsBlock([]), undefined);
  });
});

describe("applyTopicSections", () => {
  function makeMessages(): RenderedMessage[] {
    return [
      { role: "human", timestamp: "Jan 15, 2026, 10:00 AM", humanIndex: 1, header: "### You · Jan 15, 2026, 10:00 AM", body: "First question" },
      { role: "assistant", header: "### Claude", body: "First answer" },
      { role: "human", timestamp: "Jan 15, 2026, 10:05 AM", humanIndex: 2, header: "### You · Jan 15, 2026, 10:05 AM", body: "Second question" },
      { role: "assistant", header: "### Claude", body: "Second answer" },
    ];
  }

  it("sets sectionHeading on the matched human message", () => {
    const messages = makeMessages();
    applyTopicSections(messages, [
      { timestamp: "Jan 15, 2026, 10:00 AM", heading: "Topic A", recap: "..." },
    ], 2);
    assert.equal(messages[0].sectionHeading, "Topic A");
    assert.equal(messages[1].sectionHeading, undefined);
    assert.equal(messages[2].sectionHeading, undefined);
  });

  it("sets sectionRange spanning to next topic start", () => {
    const messages = makeMessages();
    applyTopicSections(messages, [
      { timestamp: "Jan 15, 2026, 10:00 AM", heading: "Topic A", recap: "..." },
      { timestamp: "Jan 15, 2026, 10:05 AM", heading: "Topic B", recap: "..." },
    ], 2);
    assert.equal(messages[0].sectionRange, "1–1");
    assert.equal(messages[2].sectionRange, "2–2");
  });

  it("sets sectionRange for last topic to reach totalHumanMessages", () => {
    const messages = makeMessages();
    applyTopicSections(messages, [
      { timestamp: "Jan 15, 2026, 10:00 AM", heading: "Topic A", recap: "..." },
    ], 2);
    assert.equal(messages[0].sectionRange, "1–2");
  });

  it("does not annotate when no matching timestamp", () => {
    const messages = makeMessages();
    applyTopicSections(messages, [
      { timestamp: "Jan 15, 2026, 99:99 PM", heading: "Topic A", recap: "..." },
    ], 2);
    assert.equal(messages[0].sectionHeading, undefined);
  });

  it("handles single topic spanning all messages", () => {
    const messages = makeMessages();
    applyTopicSections(messages, [
      { timestamp: "Jan 15, 2026, 10:00 AM", heading: "Everything", recap: "..." },
    ], 2);
    assert.equal(messages[0].sectionHeading, "Everything");
    assert.equal(messages[0].sectionRange, "1–2");
  });
});

describe("parseTocFromMarkdown", () => {
  it("parses obsidian format with recap sub-bullets", () => {
    const md = [
      "---",
      'title: "Test"',
      "---",
      "",
      "## Table of Contents",
      "",
      "- [[#GTD and task execution *(msgs 1\u20133)*]]",
      "  - Gleb asked about GTD. Claude explained the methodology.",
      "- [[#PARA critique *(msgs 4\u20136)*]]",
      "  - Gleb critiqued PARA. Claude acknowledged the trade-offs.",
      "",
      "## More content",
    ].join("\n");

    const result = parseTocFromMarkdown(md);
    assert.ok(result !== null);
    assert.equal(result!.topics.length, 2);
    assert.equal(result!.topics[0].heading, "GTD and task execution");
    assert.equal(result!.topics[0].range, "1\u20133");
    assert.equal(result!.topics[0].recap, "Gleb asked about GTD. Claude explained the methodology.");
    assert.equal(result!.topics[1].heading, "PARA critique");
    assert.equal(result!.topics[1].range, "4\u20136");
    assert.equal(result!.lastCoveredMsg, 6);
  });

  it("parses obsidian single-message entry (msg N syntax)", () => {
    const md = [
      "## Table of Contents",
      "",
      "- [[#Only topic *(msg 1)*]]",
    ].join("\n");

    const result = parseTocFromMarkdown(md);
    assert.ok(result !== null);
    assert.equal(result!.topics[0].range, "1\u20131");
    assert.equal(result!.lastCoveredMsg, 1);
  });

  it("parses standard format entries", () => {
    const md = [
      "## Table of Contents",
      "",
      "- [GTD and task execution *(msgs 1\u20133)*](#gtd-and-task-execution-msgs-1-3)",
      "- [PARA critique *(msgs 4\u20136)*](#para-critique-msgs-4-6)",
    ].join("\n");

    const result = parseTocFromMarkdown(md);
    assert.ok(result !== null);
    assert.equal(result!.topics.length, 2);
    assert.equal(result!.topics[0].heading, "GTD and task execution");
    assert.equal(result!.topics[0].range, "1\u20133");
    assert.equal(result!.topics[1].heading, "PARA critique");
    assert.equal(result!.topics[1].range, "4\u20136");
    assert.equal(result!.lastCoveredMsg, 6);
  });

  it("parses standard format single-message entry (msg-N anchor suffix)", () => {
    const md = [
      "## Table of Contents",
      "",
      "- [Only topic *(msg 1)*](#only-topic-msg-1)",
    ].join("\n");

    const result = parseTocFromMarkdown(md);
    assert.ok(result !== null);
    assert.equal(result!.topics[0].range, "1\u20131");
    assert.equal(result!.lastCoveredMsg, 1);
  });

  it("parses old obsidian pipe format for backward compat", () => {
    const md = [
      "## Table of Contents",
      "",
      "- [[#GTD and task execution *(msgs 1\u20133)*|GTD and task execution]]",
      "- [[#PARA critique *(msgs 4\u20136)*|PARA critique]]",
    ].join("\n");

    const result = parseTocFromMarkdown(md);
    assert.ok(result !== null);
    assert.equal(result!.topics[0].heading, "GTD and task execution");
    assert.equal(result!.topics[0].range, "1\u20133");
    assert.equal(result!.topics[1].heading, "PARA critique");
    assert.equal(result!.lastCoveredMsg, 6);
  });

  it("parses old standard anchor-based format for backward compat", () => {
    const md = [
      "## Table of Contents",
      "",
      "- [GTD and task execution](#gtd-and-task-execution-msgs-1-3)",
      "- [PARA critique](#para-critique-msgs-4-6)",
    ].join("\n");

    const result = parseTocFromMarkdown(md);
    assert.ok(result !== null);
    assert.equal(result!.topics[0].heading, "GTD and task execution");
    assert.equal(result!.topics[0].range, "1\u20133");
    assert.equal(result!.lastCoveredMsg, 6);
  });

  it("returns null when no Table of Contents heading found", () => {
    assert.equal(parseTocFromMarkdown("# Title\n\nsome content"), null);
  });

  it("returns null when TOC block has unrecognized bullet format", () => {
    const md = "## Table of Contents\n\n- some plain bullet\n";
    assert.equal(parseTocFromMarkdown(md), null);
  });

  it("handles missing recap (no sub-bullet) gracefully", () => {
    const md = [
      "## Table of Contents",
      "",
      "- [[#Topic *(msg 1)*]]",
      "- [[#Topic 2 *(msgs 2\u20133)*]]",
    ].join("\n");

    const result = parseTocFromMarkdown(md);
    assert.ok(result !== null);
    assert.equal(result!.topics[0].recap, "");
    assert.equal(result!.topics[1].recap, "");
  });
});

describe("buildIncrementalEntries", () => {
  function makeMessages(): RenderedMessage[] {
    return [
      { role: "human", timestamp: "Jan 15, 2026, 10:00 AM", humanIndex: 1, header: "### You", body: "q1" },
      { role: "assistant", header: "### Claude", body: "a1" },
      { role: "human", timestamp: "Jan 15, 2026, 10:05 AM", humanIndex: 2, header: "### You", body: "q2" },
      { role: "assistant", header: "### Claude", body: "a2" },
      { role: "human", timestamp: "Jan 15, 2026, 10:10 AM", humanIndex: 3, header: "### You", body: "q3" },
      { role: "assistant", header: "### Claude", body: "a3" },
    ];
  }

  it("converts existing TocTopics to AgentTocEntries using message timestamps", () => {
    const messages = makeMessages();
    const existing: TocTopic[] = [
      { heading: "Topic A", range: "1\u20132", recap: "recap A" },
    ];
    const result = buildIncrementalEntries(messages, existing, []);
    assert.equal(result.length, 1);
    assert.equal(result[0].timestamp, "Jan 15, 2026, 10:00 AM");
    assert.equal(result[0].heading, "Topic A");
    assert.equal(result[0].recap, "recap A");
  });

  it("appends new entries after existing ones", () => {
    const messages = makeMessages();
    const existing: TocTopic[] = [
      { heading: "Topic A", range: "1\u20132", recap: "recap A" },
    ];
    const newEntries: AgentTocEntry[] = [
      { timestamp: "Jan 15, 2026, 10:10 AM", heading: "Topic B", recap: "recap B" },
    ];
    const result = buildIncrementalEntries(messages, existing, newEntries);
    assert.equal(result.length, 2);
    assert.equal(result[0].heading, "Topic A");
    assert.equal(result[1].heading, "Topic B");
    assert.equal(result[1].timestamp, "Jan 15, 2026, 10:10 AM");
  });

  it("skips existing entries whose start humanIndex has no matching message", () => {
    const messages = makeMessages();
    const existing: TocTopic[] = [
      { heading: "Ghost", range: "99\u2013100", recap: "" },
      { heading: "Real", range: "1\u20132", recap: "ok" },
    ];
    const result = buildIncrementalEntries(messages, existing, []);
    assert.equal(result.length, 1);
    assert.equal(result[0].heading, "Real");
  });
});

describe("parseKeyTopicsFlatFromTemplate", () => {
  it("extracts topics using the template line as a pattern", () => {
    const template = "- **Topics**: {{keyTopicsFlat}}";
    const markdown = "- **Topics**: GTD, PARA, Obsidian";
    const result = parseKeyTopicsFlatFromTemplate(markdown, template);
    assert.deepEqual(result, ["GTD", "PARA", "Obsidian"]);
  });

  it("handles template with surrounding text on the same line", () => {
    const template = "topics: {{keyTopicsFlat}} (generated)";
    const markdown = "topics: GTD, PARA (generated)";
    const result = parseKeyTopicsFlatFromTemplate(markdown, template);
    assert.deepEqual(result, ["GTD", "PARA"]);
  });

  it("returns null when template has no {{keyTopicsFlat}}", () => {
    const result = parseKeyTopicsFlatFromTemplate("- **Topics**: GTD", "- **Topics**: {{keyTopics}}");
    assert.equal(result, null);
  });

  it("returns null when rendered line does not match the template pattern", () => {
    const template = "- **Topics**: {{keyTopicsFlat}}";
    const result = parseKeyTopicsFlatFromTemplate("## Some other content", template);
    assert.equal(result, null);
  });
});
