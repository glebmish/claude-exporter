import { readFileSync } from "node:fs";
import { runExport, StageError } from "../../packages/orchestrator/index.ts";
import { log } from "../../packages/chrome/index.ts";
import { parseArgv } from "./argv.ts";
import { prosePresenter, jsonPresenter, type Presenter } from "./presenter.ts";
import { NodeFs } from "./fs-node.ts";

function classifyError(e: unknown): { stage: string; message: string } {
  // "Cancelled" is a sentinel string thrown from many AbortSignal check sites; keep it
  // as a separate stage rather than promoting StageError everywhere.
  if (e instanceof Error && e.message === "Cancelled") return { stage: "cancelled", message: e.message };
  if (e instanceof StageError) return { stage: e.stage, message: e.message };
  // Node fs errors carry a structured `code` we can map without inspecting prose.
  const code = (e as NodeJS.ErrnoException | undefined)?.code;
  if (typeof code === "string" && /^E[A-Z]+$/.test(code)) {
    if (code === "EACCES" || code === "EPERM" || code === "ENOENT" || code === "ENOSPC" || code === "EISDIR" || code === "ENOTDIR") {
      return { stage: "filesystem", message: e instanceof Error ? e.message : String(e) };
    }
  }
  return { stage: "unknown", message: e instanceof Error ? e.message : String(e) };
}

async function main(): Promise<number> {
  const rawArgs = process.argv.slice(2);
  const wantsJson = rawArgs.includes("--json");
  const parsed = parseArgv(rawArgs);
  if (parsed.kind === "error") {
    if (wantsJson) {
      process.stdout.write(JSON.stringify({ error: { stage: "usage", message: parsed.message.split("\n")[0] } }) + "\n");
    } else {
      process.stderr.write(parsed.message + "\n");
    }
    return 2;
  }
  if (parsed.debug) log.enable();

  const presenter: Presenter = parsed.json ? jsonPresenter() : prosePresenter();
  const fs = new NodeFs();

  let templateText: string | undefined;
  if (parsed.templatePath) {
    try { templateText = readFileSync(parsed.templatePath, "utf8"); }
    catch (e: unknown) {
      const { stage, message } = classifyError(e);
      presenter.error(stage, `could not read template: ${message}`);
      return 1;
    }
  }

  // With --template, the placeholders in the template body declare which enrichment is needed.
  // argv guarantees --toc/--toc-recap/--topics are not set in this case.
  const enrichmentFromTemplate = templateText
    ? {
        toc: /\{\{toc\}\}/.test(templateText),
        tocRecap: /\{\{tocWithRecap\}\}/.test(templateText),
        topics: /\{\{(keyTopics|keyTopicsFlat)\}\}/.test(templateText),
      }
    : null;

  const opts = {
    ...parsed.opts,
    ...(templateText ? { templateText } : {}),
    ...(enrichmentFromTemplate ?? {}),
  };

  const ac = new AbortController();
  const onSigint = () => ac.abort();
  process.on("SIGINT", onSigint);
  try {
    const result = await runExport(opts, {
      fs,
      onStatus: (m) => presenter.status(m),
      signal: ac.signal,
    });
    presenter.result(result);
    return 0;
  } catch (e: unknown) {
    const { stage, message } = classifyError(e);
    presenter.error(stage, message);
    if (stage === "cancelled") return 130;
    // not_found is a benign skip (chat deleted/never existed) — no output written, exit 0.
    if (stage === "not_found") return 0;
    return 1;
  } finally {
    process.off("SIGINT", onSigint);
  }
}

main().then((code) => process.exit(code));
