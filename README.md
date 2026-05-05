# Claude AI Exporter

Export Claude.ai conversations to Markdown — as a CLI, a Chrome extension, or an Obsidian plugin. Produces readable notes with artifacts, tool use, citations, and an optional AI-generated table of contents.

## Three ways to use it

| | What it is | For |
|---|---|---|
| **CLI** (`cli/`) | `claude-export <url>` in the terminal | Scripts, batch exports, one-off dumps |
| **Chrome extension** (`extension/`) | Popup on claude.ai, downloads Markdown + artifacts | Quick manual exports while browsing |
| **Obsidian plugin** (`obsidian-plugin/`) | Exports directly into a vault, with per-note refresh and a Refresh-All modal | Keeping a searchable archive inside Obsidian |

All three share the same converter, so output is consistent across them.

## Features

- Markdown rendering in two flavors: **standard** (plain) and **Obsidian** (callouts, wikilink anchors)
- Artifact extraction — each artifact written as a separate file, linked from the note
- Inline citations + a consolidated links section
- Tool use rendered as a collapsible callout so it doesn't dominate the note
- Template system with named variables — customize the note layout without touching code
- Optional AI enrichment — table of contents, per-topic recap, and key topics
- Incremental re-export — only new messages are rendered; existing AI-generated TOC entries are reused

## How authentication works

On first run, the tool launches a **separate Chrome profile** (empty, isolated from your main browser) and opens claude.ai. You log in once in that window; the session cookie stays in that profile for subsequent exports. Nothing is stored by the tool itself — no tokens, no credentials — and nothing leaves your machine. The Chrome instance is driven over the DevTools Protocol to read conversations as your logged-in browser would.

## Install & build (from source)

```bash
git clone https://github.com/glebmish/claude-ai-exporter.git
cd claude-ai-exporter
npm install
```

Then build whichever consumer(s) you want:

```bash
npm run build:cli         # → cli/dist/main.mjs
npm run build:extension   # → extension/dist/
npm run build:plugin      # → obsidian-plugin/main.js
```

There's also `npm run dev:plugin` for watch-mode builds while iterating on the plugin, and `npm test` to run the test suite.

### CLI

After `build:cli`, run the bundled entry directly:

```bash
node cli/dist/main.mjs <chat-url-or-id> [flags]
```

Or link it globally as `claude-export`:

```bash
npm link
claude-export <chat-url-or-id> [flags]
```

Flags:

| Flag | Meaning |
|---|---|
| `--output <dir>`, `-o` | Output directory (default: current dir) |
| `--thinking` | Include the assistant's thinking blocks |
| `--tools` | Include tool-call details |
| `--no-artifacts` | Skip artifact files |
| `--toc` | Generate an AI table of contents (requires the `claude` CLI to be installed and logged in) |
| `--toc-recap` | TOC with per-topic recap |
| `--topics` | Generate a key-topics list |
| `--existing <file>` | Merge into an existing export; only new messages are rendered |
| `--chat-name <tpl>` | Filename template for the chat note (default `{{created}}_{{title}}`) — see "Filename templates" below |
| `--artifact-name <tpl>` | Filename template for artifacts (default `{{seqNum}}_{{title}}`) |
| `--debug` | Verbose logging |

### Chrome extension

After `build:extension`:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select the `extension/` directory
4. Click the extension icon on any `claude.ai/chat/...` page

### Obsidian plugin

After `build:plugin`, copy the plugin files into your vault (**copy, not symlink** — symlinks break Obsidian Sync):

```bash
mkdir -p <vault>/.obsidian/plugins/claude-exporter
cp obsidian-plugin/main.js obsidian-plugin/manifest.json <vault>/.obsidian/plugins/claude-exporter/
```

Then in **Settings → Community plugins**, enable **Claude Exporter**.

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

The chat note filename and artifact filenames are also templated. Configurable in Obsidian plugin settings, or via `--chat-name` / `--artifact-name` flags on the CLI:

| Setting | Default | Variables |
|---|---|---|
| **Chat file name** | `{{created}}_{{title}}` | `{{title}}`, `{{created}}`, `{{updated}}`, `{{exported}}`, `{{model}}`, `{{messages}}`, `{{artifacts}}` |
| **Artifact file name** | `{{seqNum}}_{{title}}` | `{{seqNum}}`, `{{title}}`, `{{chatTitle}}`, `{{chatCreated}}` |

Extensions are appended automatically. Unknown variables (e.g. typos like `{{ttile}}`) are left literal in the resulting filename so mistakes are visible. If the template renders empty, the filename falls back to `untitled`.

## AI enrichment (optional)

The TOC, recap, and key-topics features use the [Claude Agent SDK](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk) with the `claude-haiku-4-5` model. Authentication is delegated to the local [`claude` CLI](https://docs.claude.com/en/docs/claude-code/overview) — whichever account you're logged into there is what gets used. No API key needs to be set anywhere in this tool.

To enable:

- Install the `claude` CLI and log in (`claude` → follow prompts)
- In the Obsidian plugin, set the path to the `claude` executable in settings (e.g. the output of `which claude`). For the CLI, `claude` just needs to be on `PATH`.
- Pick which enrichment you want via template variables (`{{toc}}`, `{{tocWithRecap}}`, `{{keyTopics}}`, `{{keyTopicsFlat}}`) or CLI flags (`--toc`, `--toc-recap`, `--topics`)

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
