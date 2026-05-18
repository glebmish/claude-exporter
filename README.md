# Claude AI Exporter

[![CI](https://github.com/glebmish/claude-exporter/actions/workflows/ci.yml/badge.svg)](https://github.com/glebmish/claude-exporter/actions/workflows/ci.yml)

Export Claude.ai conversations to Markdown straight into your Obsidian vault — or, if you prefer, via a CLI or a Chrome extension. Produces readable notes with artifacts, tool use, citations, and an optional AI-generated table of contents.

<!--
  📺 Demo

  TODO: drop a GIF or short MP4 of the Obsidian plugin in action here.
  Suggested flow: open a Claude chat → run "Export current Claude chat" command →
  show the rendered note in the vault with TOC, callouts, and artifacts.

  Replace this comment with:
    ![demo](./docs/demo.gif)
  or:
    <video src="./docs/demo.mp4" controls></video>
-->

> **Demo:** _coming soon — GIF/video walkthrough of the Obsidian plugin._

## Three ways to use it

| | What it is | For |
|---|---|---|
| **Obsidian plugin** (`obsidian-plugin/`) | Exports directly into a vault, with per-note refresh and a Refresh-All modal | Keeping a searchable archive inside Obsidian |
| **CLI** (`cli/`) | `claude-exporter <url>` in the terminal | Scripts, batch exports, one-off dumps |
| **Chrome extension** (`extension/`) | Popup on claude.ai, downloads Markdown + artifacts | Quick manual exports while browsing |

All three share the same converter, so output is consistent across them.

## Features

- Markdown rendering in two flavors: **standard** (plain) and **Obsidian** (callouts, wikilink anchors)
- Artifact extraction — each artifact written as a separate file, linked from the note
- Inline citations + a consolidated links section, with each link annotated by the tool that surfaced it (`web_search`, `web_fetch`, …)
- Tool use rendered as a collapsible callout, with execution duration and MCP integration name when the conversation API exposes them
- Active-branch filtering — when you edited a message and retried, only the branch you actually kept ends up in the exported note
- Template system with named variables — customize the note layout without touching code
- Optional AI enrichment — table of contents, per-topic recap, and key topics
- Incremental re-export — only new messages are rendered; existing AI-generated TOC entries are reused

## How authentication works

On first run, the tool launches a **separate Chrome profile** (empty, isolated from your main browser) and opens claude.ai. You log in once in that window; the session cookie stays in that profile for subsequent exports. Nothing is stored by the tool itself — no tokens, no credentials — and nothing leaves your machine. The Chrome instance is driven over the DevTools Protocol to read conversations as your logged-in browser would.

## Install & build (from source)

```bash
git clone https://github.com/glebmish/claude-exporter.git
cd claude-exporter
npm install
```

Then build whichever consumer(s) you want:

```bash
npm run build:cli         # → cli/dist/main.mjs
npm run build:extension   # → extension/dist/
npm run build:plugin      # → obsidian-plugin/dist/ (main.js + manifest.json)
```

There's also `npm run dev:plugin` for watch-mode builds while iterating on the plugin, and `npm test` to run the test suite.

### Obsidian plugin

After `build:plugin`, copy the plugin files into your vault (**copy, not symlink** — symlinks break Obsidian Sync):

```bash
mkdir -p <vault>/.obsidian/plugins/claude-exporter
cp obsidian-plugin/dist/* <vault>/.obsidian/plugins/claude-exporter/
```

Then in **Settings → Community plugins**, enable **Claude Exporter**.

### CLI

After `build:cli`, run the bundled entry directly:

```bash
node cli/dist/main.mjs <chat-url-or-id> [flags]
```

Or link it globally as `claude-exporter`:

```bash
npm link
claude-exporter <chat-url-or-id> [flags]
```

Flags:

| Flag | Meaning |
|---|---|
| `--output-dir <dir>`, `-o` | Note directory (default: current dir) |
| `--attachments-dir <dir>` | Override attachments destination (defaults alongside the note) |
| `--format standard\|obsidian` | Markdown flavor (default: `standard`) |
| `--template <path>` | Path to a markdown template file (`{{title}}`, `{{header}}`, `{{content}}`, `{{toc}}`, etc.) |
| `--chat-name <name>` | Literal chat filename (no `{{var}}` substitution) |
| `--chat-name-template <tpl>` | Templated chat filename (default `{{created}} {{title}}`) — see "Filename templates" below |
| `--artifact-name-template <tpl>` | Templated artifact filename (default `{{seqNum}} {{title}}`) |
| `--no-artifacts` | Skip artifact files |
| `--no-images` | Skip inline image fetch (images are fetched by default) |
| `--thinking` | Include the assistant's thinking blocks |
| `--tools` | Include tool-call details |
| `--toc headers\|recap` | AI table of contents — `headers` for plain headings, `recap` for per-topic summaries (requires the `claude` CLI to be installed and logged in) |
| `--topics` | Generate a key-topics list |
| `--existing <file>` | Reuse TOC and key-topics from an existing export; stale attachments under the same datedTitle are cleaned. While running, the `{{exported}}`-bound frontmatter key is patched to `updating` so concurrent readers don't pick up the stale file |
| `--json` | Machine-readable single-object stdout; logs go to stderr |
| `--debug` | Verbose logging to stderr |
| `--chrome-path <path>` | Path to Chrome binary (env: `CHROME_PATH`) |
| `--chrome-port <n>` | CDP port (default 9222) |

Constraints:

- `--chat-name` and `--chat-name-template` are mutually exclusive.
- `--template` cannot be combined with `--toc` or `--topics` — when using a template, declare enrichment via the `{{toc}}`, `{{tocWithRecap}}`, `{{keyTopics}}`, or `{{keyTopicsFlat}}` placeholders in the template body instead.

### Chrome extension

After `build:extension`:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `extension/` directory
4. Click the extension icon on any `claude.ai/chat/...` page

## Template system

Every exported note is rendered through a template string. The default template lives in the plugin settings / CLI; override it to change layout. Variables use `{{name}}` syntax.

| Variable | Content |
|---|---|
| `{{title}}` | Conversation title |
| `{{content}}` | Rendered messages + links section — the main body |
| `{{header}}` | Title + date range + model + message count block |
| `{{url}}` | Source URL on claude.ai |
| `{{model}}` | Model used in the conversation |
| `{{created}}`, `{{updated}}`, `{{exported}}` | ISO date strings |
| `{{createdTimestamp}}`, `{{updatedTimestamp}}` | Unix timestamps (seconds) |
| `{{messages}}` | Message count |
| `{{artifacts}}` | Artifact count |
| `{{toc}}` | AI-generated table of contents — empty unless enrichment is enabled |
| `{{tocWithRecap}}` | TOC with a short recap per topic |
| `{{keyTopics}}` | Key topics as a bullet list |
| `{{keyTopicsFlat}}` | Key topics as a comma-delimited string (handy for frontmatter tags) |

If `{{content}}` is not present in the template, the rendered content is appended to the end.

### Filename templates

The chat note filename and artifact filenames are also templated. Configurable in Obsidian plugin settings, or via `--chat-name-template` / `--artifact-name-template` flags on the CLI. Use `--chat-name <literal>` to override with an exact filename (no substitution):

| Setting | Default | Variables |
|---|---|---|
| **Chat file name** | `{{created}} {{title}}` | `{{title}}`, `{{titleSanitized}}`, `{{created}}`, `{{updated}}`, `{{exported}}`, `{{model}}`, `{{messages}}`, `{{artifacts}}` |
| **Artifact file name** | `{{seqNum}} {{title}}` | `{{seqNum}}`, `{{title}}`, `{{titleSanitized}}`, `{{chatTitle}}`, `{{chatTitleSanitized}}`, `{{chatCreated}}` |

`{{title}}` (and `{{chatTitle}}`) preserve case and spaces — only filesystem-unsafe characters are stripped. Defaults produce Obsidian-style names like `2026-04-28 Project Roadmap.md` and `01 Setup Guide.md`.

Extensions are appended automatically. Unknown variables (e.g. typos like `{{ttile}}`) are left literal in the resulting filename so mistakes are visible. If the template renders empty, the filename falls back to `untitled`.

## AI enrichment (optional)

The TOC, recap, and key-topics features use the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) with the `claude-haiku-4-5` model. Authentication is delegated to the local [`claude` CLI](https://docs.claude.com/en/docs/claude-code/overview) — whichever account you're logged into there is what gets used. No API key needs to be set anywhere in this tool.

To enable:

- Install the `claude` CLI and log in (`claude` → follow prompts)
- In the Obsidian plugin, set the path to the `claude` executable in settings (e.g. the output of `which claude`). For the CLI, `claude` just needs to be on `PATH`.
- Pick which enrichment you want via template variables (`{{toc}}`, `{{tocWithRecap}}`, `{{keyTopics}}`, `{{keyTopicsFlat}}`) or CLI flags (`--toc headers|recap`, `--topics`). The two surfaces are mutually exclusive: with `--template`, placeholders carry the intent

Incremental re-export: when re-exporting a note that already has a TOC, existing entries are parsed and reused, and the model only runs if new messages were added. This keeps re-exports cheap and stable.

## Project layout

```
cli/                  CLI entry point and esbuild config
extension/            Chrome MV3 extension (popup, content script, settings)
obsidian-plugin/      Obsidian plugin (UI, export orchestration, settings)
packages/
  converter/          Conversation JSON → Markdown, template substitution
  chrome/             Separate-profile Chrome lifecycle + CDP WebSocket client
  toc/                AI enrichment via Claude Agent SDK (Haiku)
test/                 Node test runner suites + fixtures
```

## License

MIT — see [LICENSE](LICENSE).
