import { readFileSync } from "node:fs";
import { runExport } from "../../packages/orchestrator/index.ts";
import { log } from "../../packages/chrome/index.ts";
import { parseArgv } from "./argv.ts";
import { prosePresenter, jsonPresenter, type Presenter } from "./presenter.ts";
import { NodeFs } from "./fs-node.ts";

function classifyError(e: unknown): { stage: string; message: string } {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg === "Cancelled") return { stage: "cancelled", message: msg };
  if (/Chrome|CDP|websocket|connect/i.test(msg)) return { stage: "cdp", message: msg };
  if (/conversation|404/i.test(msg)) return { stage: "conversation", message: msg };
  if (/EACCES|ENOENT|ENOSPC/i.test(msg)) return { stage: "filesystem", message: msg };
  if (/login|cookie|auth/i.test(msg)) return { stage: "auth", message: msg };
  if (/mutually exclusive|requires/i.test(msg)) return { stage: "usage", message: msg };
  return { stage: "unknown", message: msg };
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

  const opts = { ...parsed.opts, ...(templateText ? { templateText } : {}) };

  try {
    const result = await runExport(opts, {
      fs,
      onStatus: (m) => presenter.status(m),
    });
    presenter.result(result);
    return 0;
  } catch (e: unknown) {
    const { stage, message } = classifyError(e);
    presenter.error(stage, message);
    return stage === "cancelled" ? 130 : 1;
  }
}

main().then((code) => process.exit(code));
