import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFs } from "../cli/src/fs-node.ts";

describe("NodeFs", () => {
  let dir: string;
  let fs: NodeFs;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nodefs-test-"));
    fs = new NodeFs();
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("readText returns null for missing file", async () => {
    assert.equal(await fs.readText(join(dir, "missing.txt")), null);
  });

  it("readText returns file contents", async () => {
    const p = join(dir, "a.txt");
    writeFileSync(p, "hello");
    assert.equal(await fs.readText(p), "hello");
  });

  it("writeText creates parent directories", async () => {
    const p = join(dir, "nested", "deep", "out.txt");
    await fs.writeText(p, "x");
    assert.equal(readFileSync(p, "utf8"), "x");
  });

  it("writeText overwrites existing file", async () => {
    const p = join(dir, "a.txt");
    writeFileSync(p, "old");
    await fs.writeText(p, "new");
    assert.equal(readFileSync(p, "utf8"), "new");
  });

  it("writeBinary writes bytes", async () => {
    const p = join(dir, "img.bin");
    const data = new Uint8Array([1, 2, 3, 4]).buffer;
    await fs.writeBinary(p, data);
    const out = readFileSync(p);
    assert.deepEqual([...out], [1, 2, 3, 4]);
  });

  it("exists is true for files and directories", async () => {
    writeFileSync(join(dir, "f.txt"), "");
    assert.equal(await fs.exists(join(dir, "f.txt")), true);
    assert.equal(await fs.exists(dir), true);
    assert.equal(await fs.exists(join(dir, "missing")), false);
  });

  it("deleteDir is recursive and idempotent", async () => {
    const sub = join(dir, "sub");
    mkdirSync(join(sub, "deep"), { recursive: true });
    writeFileSync(join(sub, "deep", "f.txt"), "");
    await fs.deleteDir(sub);
    assert.equal(existsSync(sub), false);
    await fs.deleteDir(sub);
  });

  it("ensureDir creates nested directories", async () => {
    const p = join(dir, "a", "b", "c");
    await fs.ensureDir(p);
    assert.equal(existsSync(p), true);
  });

  it("joinPath uses node:path", () => {
    assert.equal(fs.joinPath("a", "b", "c.md"), "a/b/c.md");
  });
});
