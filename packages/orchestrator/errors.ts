export type ErrorStage =
  | "cancelled"
  | "cdp"
  | "conversation"
  | "not_found"
  | "filesystem"
  | "auth"
  | "usage";

export class StageError extends Error {
  readonly stage: ErrorStage;
  constructor(stage: ErrorStage, message: string, opts?: ErrorOptions) {
    super(message, opts);
    this.name = "StageError";
    this.stage = stage;
  }
}
