import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { extractAuth } from "../packages/chrome/index.ts";

describe("extractAuth", () => {
  it("extracts sessionKey and orgId from cookies", () => {
    const cookies = [
      { name: "sessionKey", value: "sk-123", domain: "claude.ai" },
      { name: "lastActiveOrg", value: "org-456", domain: "claude.ai" },
      { name: "other", value: "irrelevant", domain: "claude.ai" },
    ];
    const auth = extractAuth(cookies);
    assert.deepEqual(auth, { sessionKey: "sk-123", orgId: "org-456" });
  });

  it("returns null when sessionKey missing", () => {
    const cookies = [
      { name: "lastActiveOrg", value: "org-456", domain: "claude.ai" },
    ];
    assert.equal(extractAuth(cookies), null);
  });

  it("returns null when orgId missing", () => {
    const cookies = [
      { name: "sessionKey", value: "sk-123", domain: "claude.ai" },
    ];
    assert.equal(extractAuth(cookies), null);
  });

  it("returns null for empty array", () => {
    assert.equal(extractAuth([]), null);
  });
});
