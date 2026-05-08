import type { ExportResult } from "../../packages/orchestrator/index.ts";

export interface Presenter {
  status(msg: string): void;
  result(r: ExportResult): void;
  error(stage: string, message: string): void;
}

export function prosePresenter(): Presenter {
  return {
    status(msg) { process.stderr.write(`${msg}\n`); },
    result(r) {
      if (r.attachmentsDir) {
        process.stdout.write(`Exported to ${r.filePath}\n`);
        process.stdout.write(`  + ${r.artifactCount} artifact(s), ${r.imageCount} image(s) under ${r.attachmentsDir}/\n`);
      } else {
        process.stdout.write(`Exported to ${r.filePath}\n`);
      }
      if (r.previousMessageCount !== undefined) {
        const delta = r.messageCount - r.previousMessageCount;
        if (delta > 0) process.stdout.write(`  refreshed: +${delta} new message(s)\n`);
        else process.stdout.write(`  refreshed: no new messages\n`);
      }
      for (const w of r.warnings) process.stderr.write(`warning: ${w}\n`);
    },
    error(stage, message) { process.stderr.write(`error (${stage}): ${message}\n`); },
  };
}

export function jsonPresenter(): Presenter {
  return {
    status(msg) { process.stderr.write(`${msg}\n`); },
    result(r) { process.stdout.write(JSON.stringify(r) + "\n"); },
    error(stage, message) { process.stdout.write(JSON.stringify({ error: { stage, message } }) + "\n"); },
  };
}
