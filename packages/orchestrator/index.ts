export type { FileSystem, ExportOptions, ExportDeps, ExportResult } from "./types.ts";
export { applyTemplate, findExportedKey, patchInProgress } from "./template.ts";
export { fetchAllImages, decodeDataUrl } from "./images.ts";
export type { ImageFile } from "./images.ts";
export { loadExistingFile, applyInProgressPatch, decideEnrichment } from "./refresh.ts";
export type { ExistingFileInfo, EnrichmentDecision, TemplateVarPresence, EnrichmentFlags } from "./refresh.ts";

export async function runExport(
  _opts: import("./types.ts").ExportOptions,
  _deps: import("./types.ts").ExportDeps,
): Promise<import("./types.ts").ExportResult> {
  throw new Error("not implemented");
}
