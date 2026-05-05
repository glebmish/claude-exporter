import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { applyFilenameTemplate, DEFAULT_CHAT_NAME_TEMPLATE, DEFAULT_ARTIFACT_NAME_TEMPLATE } from "../packages/converter/filename-template.ts";

describe("applyFilenameTemplate", () => {
  it("substitutes a single variable", () => {
    const out = applyFilenameTemplate("{{title}}", { title: "my_chat" });
    assert.equal(out, "my_chat");
  });

  it("substitutes multiple variables", () => {
    const out = applyFilenameTemplate("{{created}}_{{title}}", {
      created: "2026-01-15",
      title: "my_chat",
    });
    assert.equal(out, "2026-01-15_my_chat");
  });

  it("substitutes the same variable multiple times", () => {
    const out = applyFilenameTemplate("{{title}}-{{title}}", { title: "x" });
    assert.equal(out, "x-x");
  });

  it("leaves unknown variables literal so typos surface", () => {
    const out = applyFilenameTemplate("{{title}}_{{typo}}", { title: "chat" });
    assert.ok(out.includes("{{typo}}"), `expected unknown var to survive, got "${out}"`);
  });

  it("falls back to 'untitled' when result is empty after cleanup", () => {
    const out = applyFilenameTemplate("{{empty}}", { empty: "" });
    assert.equal(out, "untitled");
  });

  it("falls back to 'untitled' when template is empty", () => {
    const out = applyFilenameTemplate("", {});
    assert.equal(out, "untitled");
  });

  it("replaces filesystem-unsafe characters with underscores", () => {
    const out = applyFilenameTemplate("{{title}}", { title: "a/b\\c:d" });
    assert.equal(out, "a_b_c_d");
  });

  it("collapses runs of underscores from substitution", () => {
    const out = applyFilenameTemplate("{{a}}_{{b}}", { a: "", b: "x" });
    assert.equal(out, "x");
  });

  it("strips leading and trailing underscores", () => {
    const out = applyFilenameTemplate("__{{title}}__", { title: "chat" });
    assert.equal(out, "chat");
  });

  it("lowercases the output", () => {
    const out = applyFilenameTemplate("{{title}}", { title: "MyChat" });
    assert.equal(out, "mychat");
  });

  it("collapses whitespace to underscores", () => {
    const out = applyFilenameTemplate("{{model}}", { model: "Sonnet 4.6" });
    assert.equal(out, "sonnet_4.6");
  });

  it("does NOT truncate long substituted output", () => {
    const long = "a".repeat(200);
    const out = applyFilenameTemplate("{{title}}", { title: long });
    assert.equal(out.length, 200);
  });

  it("default chat template reproduces legacy '{date}_{title}' shape", () => {
    const out = applyFilenameTemplate(DEFAULT_CHAT_NAME_TEMPLATE, {
      title: "my_chat",
      created: "2026-01-15",
    });
    assert.equal(out, "2026-01-15_my_chat");
  });

  it("default artifact template reproduces legacy '{NN}_{title}' shape", () => {
    const out = applyFilenameTemplate(DEFAULT_ARTIFACT_NAME_TEMPLATE, {
      seqNum: "01",
      title: "my_artifact",
    });
    assert.equal(out, "01_my_artifact");
  });
});
