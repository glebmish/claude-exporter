# claude-exporter

[![CI](https://github.com/glebmish/claude-exporter/actions/workflows/ci.yml/badge.svg)](https://github.com/glebmish/claude-exporter/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/claude-exporter.svg)](https://www.npmjs.com/package/claude-exporter)
[![npm downloads](https://img.shields.io/npm/dm/claude-exporter.svg)](https://www.npmjs.com/package/claude-exporter)
[![License: MIT](https://img.shields.io/github/license/glebmish/claude-exporter.svg)](LICENSE)

Export Claude.ai conversations to Markdown from the terminal — with artifacts, tool calls, citations, and an optional AI-generated table of contents.

```bash
npx claude-exporter https://claude.ai/chat/<id>
```

> This is the CLI surface. There is also an [Obsidian plugin](https://github.com/glebmish/claude-exporter#obsidian) and a [Chrome extension](https://github.com/glebmish/claude-exporter#chrome-extension) that share the same converter — see the [main README on GitHub](https://github.com/glebmish/claude-exporter#readme) for those.

## Install

Run without installing:

```bash
npx claude-exporter <chat-url-or-id> [flags]
```

Or install globally:

```bash
npm install -g claude-exporter
claude-exporter <chat-url-or-id> [flags]
```

Requires **Node 18 or newer**. Chrome (or another Chromium build) must be installed; the CLI launches it in a separate profile — see [Access to claude.ai chats](#access-to-claudeai-chats).

## Examples

```bash
# Full list of arguments
claude-exporter --help

# Quickest start — export one chat into the current folder
npx claude-exporter https://claude.ai/chat/abc-123

# Text-only — skip artifact files and inline images
npx claude-exporter https://claude.ai/chat/abc-123 --no-artifacts --no-images

# Full transcript — include assistant thinking blocks and tool-call details
npx claude-exporter https://claude.ai/chat/abc-123 --thinking --tools

# Custom Markdown layout via a template file
npx claude-exporter https://claude.ai/chat/abc-123 --template ./my-template.md

# AI table of contents with per-topic recaps
# (requires the `claude` CLI installed and logged in — see "AI enrichment" below)
npx claude-exporter https://claude.ai/chat/abc-123 --toc recap

# Vault-style export: Obsidian flavor, custom template, attachments
# redirected to a shared Attachments folder
npx claude-exporter https://claude.ai/chat/abc-123 \
  -o ~/vault/Claude \
  --attachments-dir ~/vault/Claude/Attachments \
  --format obsidian \
  --template ~/vault/Claude/_claude-template.md
```

## Flags

```
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
```

## Access to claude.ai chats

On first run, the CLI launches a **separate Chrome profile** (empty, isolated from your main browser) and opens claude.ai. You log in once in that window; the session cookie stays in that profile for subsequent exports. Chrome is driven over the DevTools Protocol, so requests to the conversation endpoint carry the same cookie a real browser would.

Nothing is stored by the tool itself — no tokens, no credentials — and nothing leaves your machine. The CLI reads Anthropic's **internal** conversation endpoint; there is no SLA on its shape, so a schema change upstream will break exports until the converter is updated.

## AI enrichment (optional)

The `--toc`, `--toc recap`, and `--topics` features use the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) with the `claude-haiku-4-5` model. Authentication is delegated to the local [`claude` CLI](https://docs.claude.com/en/docs/claude-code/overview) — whichever account you're logged into there is what gets used. **No API key needs to be set anywhere.**

Without the `claude` CLI installed and logged in, enrichment flags and template placeholders render empty.

Incremental re-export: when re-exporting a note (`--existing`) that already has a TOC, existing entries are parsed and reused, and the model only runs if new messages were added.

## Templates

Every exported note is rendered through a template string. Override the default with `--template <path>`. Variables use `{{name}}` syntax — see the [Template system](https://github.com/glebmish/claude-exporter#template-system) section in the main README for the full variable list.

## Limitations

- **Manual login on first run.** The first export pops up a Chrome window for an interactive sign-in; subsequent exports reuse the profile cookie until it expires.
- **Requires Chrome on disk.** No headless fallback and no built-in Chromium. Point `--chrome-path` (or `CHROME_PATH`) at any Chromium build if Chrome isn't your default.
- **Internal API.** No SLA on the upstream conversation endpoint; an upstream schema change can break exports until the converter is updated.

## Changelog

Release notes live on the [GitHub Releases page](https://github.com/glebmish/claude-exporter/releases).

## License

MIT — see [LICENSE](https://github.com/glebmish/claude-exporter/blob/main/LICENSE).
