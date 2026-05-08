export type { FileSystem, ExportOptions, ExportDeps, ExportResult } from "./types.ts";

export async function runExport(
  _opts: import("./types.ts").ExportOptions,
  _deps: import("./types.ts").ExportDeps,
): Promise<import("./types.ts").ExportResult> {
  throw new Error("not implemented");
}
