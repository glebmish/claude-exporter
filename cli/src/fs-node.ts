import { promises as fsp } from "node:fs";
import { dirname, join } from "node:path";
import type { FileSystem } from "../../packages/orchestrator/types.ts";

export class NodeFs implements FileSystem {
  async readText(path: string): Promise<string | null> {
    try {
      return await fsp.readFile(path, "utf8");
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async writeText(path: string, content: string): Promise<void> {
    await fsp.mkdir(dirname(path), { recursive: true });
    await fsp.writeFile(path, content, "utf8");
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    await fsp.mkdir(dirname(path), { recursive: true });
    await fsp.writeFile(path, Buffer.from(data));
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fsp.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  async deleteDir(path: string): Promise<void> {
    await fsp.rm(path, { recursive: true, force: true });
  }

  async ensureDir(path: string): Promise<void> {
    await fsp.mkdir(path, { recursive: true });
  }

  joinPath(...parts: string[]): string {
    return join(...parts);
  }
}
