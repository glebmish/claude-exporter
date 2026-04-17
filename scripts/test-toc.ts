/**
 * Test enrichWithToc against an already-exported markdown file.
 *
 * Usage:
 *   node --experimental-strip-types scripts/test-toc.ts <path-to-md-file>
 */

import { readFileSync } from "node:fs";
import { enrichWithToc } from "../packages/toc/index.ts";
import type { ConversationResult } from "../packages/converter/index.ts";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node --experimental-strip-types scripts/test-toc.ts <path-to-md-file>");
  process.exit(1);
}

const text = readFileSync(filePath, "utf-8");

// Extract frontmatter fields
const fmMatch = text.match(/^---\n([\s\S]*?)\n---\n/);
const fm = fmMatch ? fmMatch[1] : "";
const getField = (key: string) => fm.match(new RegExp(`^${key}: (.*)$`, "m"))?.[1]?.replace(/^"|"$/g, "").trim() ?? "";

// Content = everything from the first "---" separator after the metadata block.
// The exported file structure is:
//   ---           ← frontmatter open
//   ...fields...
//   ---           ← frontmatter close
//
//   # Title
//   - **Created**: ...
//   ...
//
//   ---           ← start of result.content
//   ## Human · ...
const fmEnd = text.indexOf("\n---\n", 4) + 5; // end of frontmatter
const contentStart = text.indexOf("\n---\n", fmEnd);
const content = contentStart !== -1 ? text.slice(contentStart + 1) : text.slice(fmEnd);

// Count H2 headings as a proxy for message count
const msgCount = (content.match(/^## /gm) || []).length;

const result: ConversationResult = {
  title: getField("title"),
  url: getField("source"),
  model: getField("model"),
  created: getField("created"),
  updated: getField("updated"),
  exported: getField("exported"),
  messages: Math.max(msgCount, 4), // ensure guard is bypassed even for short files
  artifacts: 0,
  content,
  artifactFiles: [],
  datedTitle: "",
};

console.log(`File: ${filePath}`);
console.log(`Messages detected: ${msgCount} (using ${result.messages} for guard)`);
console.log("Calling enrichWithToc...\n");

const enriched = await enrichWithToc(result, "obsidian");

if (enriched.toc) {
  console.log("=== TOC ===");
  console.log(enriched.toc);
  console.log();
}

if (enriched.tocWithRecap) {
  console.log("=== TOC WITH RECAP ===");
  console.log(enriched.tocWithRecap);
  console.log();
}

if (enriched.keyTopics) {
  console.log("=== KEY TOPICS ===");
  console.log(enriched.keyTopics);
  console.log();
}

if (!enriched.toc && !enriched.keyTopics) {
  console.log("No TOC or key topics generated (conversation may have too few topic shifts).");
}
