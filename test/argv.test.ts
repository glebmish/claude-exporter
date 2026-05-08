import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { parseArgv } from "../cli/src/argv.ts";

describe("parseArgv", () => {
  it("requires a positional chat URL/ID", () => {
    const r = parseArgv(["--output-dir", "out"]);
    assert.equal(r.kind, "error");
    if (r.kind === "error") assert.match(r.message, /chat|missing/i);
  });

  it("parses default flags", () => {
    const r = parseArgv(["12345678-1234-1234-1234-123456789012"]);
    assert.equal(r.kind, "ok");
    if (r.kind !== "ok") return;
    assert.equal(r.opts.conversationId, "12345678-1234-1234-1234-123456789012");
    assert.equal(r.opts.outputDir, ".");
    assert.equal(r.opts.format, "standard");
    assert.equal(r.opts.includeArtifacts, true);
    assert.equal(r.opts.includeImages, true);
    assert.equal(r.opts.includeThinking, false);
    assert.equal(r.opts.includeToolCalls, false);
    assert.equal(r.opts.toc, false);
    assert.equal(r.opts.tocRecap, false);
    assert.equal(r.opts.topics, false);
    assert.equal(r.opts.patchInProgress, false);
    assert.equal(r.json, false);
    assert.equal(r.debug, false);
  });

  it("--output-dir / -o sets outputDir", () => {
    const r1 = parseArgv(["12345678-1234-1234-1234-123456789012", "--output-dir", "x"]);
    const r2 = parseArgv(["12345678-1234-1234-1234-123456789012", "-o", "y"]);
    assert.equal(r1.kind === "ok" && r1.opts.outputDir, "x");
    assert.equal(r2.kind === "ok" && r2.opts.outputDir, "y");
  });

  it("--format obsidian sets format", () => {
    const r = parseArgv(["12345678-1234-1234-1234-123456789012", "--format", "obsidian"]);
    assert.equal(r.kind === "ok" && r.opts.format, "obsidian");
  });

  it("rejects --format other", () => {
    const r = parseArgv(["12345678-1234-1234-1234-123456789012", "--format", "html"]);
    assert.equal(r.kind, "error");
  });

  it("--no-images flips includeImages off", () => {
    const r = parseArgv(["12345678-1234-1234-1234-123456789012", "--no-images"]);
    assert.equal(r.kind === "ok" && r.opts.includeImages, false);
  });

  it("--no-artifacts flips includeArtifacts off", () => {
    const r = parseArgv(["12345678-1234-1234-1234-123456789012", "--no-artifacts"]);
    assert.equal(r.kind === "ok" && r.opts.includeArtifacts, false);
  });

  it("--chat-name and --chat-name-template are mutually exclusive", () => {
    const r = parseArgv([
      "12345678-1234-1234-1234-123456789012",
      "--chat-name", "x",
      "--chat-name-template", "{{title}}",
    ]);
    assert.equal(r.kind, "error");
    if (r.kind === "error") assert.match(r.message, /mutually exclusive/);
  });

  it("--patch-in-progress without --existing → error", () => {
    const r = parseArgv(["12345678-1234-1234-1234-123456789012", "--patch-in-progress"]);
    assert.equal(r.kind, "error");
    if (r.kind === "error") assert.match(r.message, /existing/);
  });

  it("--patch-in-progress with --existing → ok", () => {
    const r = parseArgv([
      "12345678-1234-1234-1234-123456789012",
      "--existing", "old.md",
      "--patch-in-progress",
    ]);
    assert.equal(r.kind, "ok");
    if (r.kind === "ok") {
      assert.equal(r.opts.patchInProgress, true);
      assert.equal(r.opts.existingFilePath, "old.md");
    }
  });

  it("--json flag sets the json presenter mode", () => {
    const r = parseArgv(["12345678-1234-1234-1234-123456789012", "--json"]);
    assert.equal(r.kind === "ok" && r.json, true);
  });

  it("unknown flag → error", () => {
    const r = parseArgv(["12345678-1234-1234-1234-123456789012", "--bogus"]);
    assert.equal(r.kind, "error");
    if (r.kind === "error") assert.match(r.message, /unknown/i);
  });

  it("--artifact-name (legacy) is now unknown → error", () => {
    const r = parseArgv(["12345678-1234-1234-1234-123456789012", "--artifact-name", "{{seqNum}}"]);
    assert.equal(r.kind, "error");
  });

  it("--output (legacy) is now unknown → error", () => {
    const r = parseArgv(["12345678-1234-1234-1234-123456789012", "--output", "x"]);
    assert.equal(r.kind, "error");
  });

  it("invalid conversation URL → error", () => {
    const r = parseArgv(["not a uuid"]);
    assert.equal(r.kind, "error");
  });

  it("URL form is parsed to ID", () => {
    const r = parseArgv(["https://claude.ai/chat/12345678-1234-1234-1234-123456789012"]);
    assert.equal(r.kind === "ok" && r.opts.conversationId, "12345678-1234-1234-1234-123456789012");
  });

  it("--template surfaces templatePath for main.ts to read", () => {
    const r = parseArgv(["12345678-1234-1234-1234-123456789012", "--template", "tpl.md"]);
    assert.equal(r.kind, "ok");
    if (r.kind === "ok") assert.equal(r.templatePath, "tpl.md");
  });

  it("--chrome-port parses to a number", () => {
    const r = parseArgv(["12345678-1234-1234-1234-123456789012", "--chrome-port", "9333"]);
    assert.equal(r.kind === "ok" && r.opts.chromePort, 9333);
  });

  it("--chrome-port rejects non-numbers", () => {
    const r = parseArgv(["12345678-1234-1234-1234-123456789012", "--chrome-port", "abc"]);
    assert.equal(r.kind, "error");
  });
});
