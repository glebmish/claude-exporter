import { get } from "node:http";
import WebSocket from "ws";
import type { Cookie } from "./types.ts";
import log from "./log.ts";

function httpGetJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      let data = "";
      res.on("data", (chunk: Buffer) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

interface CdpResponse {
  id: number;
  result?: Record<string, unknown>;
  error?: { message: string };
  method?: string;
}

export class CdpClient {
  private ws: WebSocket;
  private msgId = 0;
  private closed = false;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.on("message", (raw: WebSocket.RawData) => {
      const msg: CdpResponse = JSON.parse(raw.toString());
      if (msg.id == null) return;
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        if (msg.error) {
          p.reject(new Error(msg.error.message));
        } else {
          p.resolve(msg.result);
        }
      }
    });
    this.ws.on("close", () => this.rejectAllPending("WebSocket closed"));
    this.ws.on("error", () => this.rejectAllPending("WebSocket error"));
  }

  private rejectAllPending(reason: string): void {
    for (const [, p] of this.pending) {
      p.reject(new Error(reason));
    }
    this.pending.clear();
  }

  static async connect(port = 9223): Promise<CdpClient> {
    const targets = (await httpGetJson(`http://localhost:${port}/json`)) as Array<{
      webSocketDebuggerUrl: string;
      type: string;
    }>;
    log("CDP targets:", targets.map(t => t.type));
    const page = targets.find((t) => t.type === "page");
    if (!page) throw new Error("No browser page found");

    const wsUrl = page.webSocketDebuggerUrl;
    if (!wsUrl?.startsWith("ws://localhost:")) {
      throw new Error(`Unexpected CDP WebSocket URL: ${wsUrl}`);
    }
    log("Connecting to:", wsUrl);
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("CDP connection timed out"));
      }, 10000);
      ws.on("open", () => {
        clearTimeout(timer);
        log("CDP WebSocket connected");
        resolve(new CdpClient(ws));
      });
      ws.on("error", (err) => {
        clearTimeout(timer);
        log("CDP WebSocket error:", err);
        reject(new Error("WebSocket connection failed"));
      });
    });
  }

  private send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = ++this.msgId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression: string): Promise<unknown> {
    const result = (await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })) as { result: { value: unknown } };
    return result.result.value;
  }

  async navigateTo(url: string, timeoutMs = 30000): Promise<void> {
    await this.send("Page.enable");
    await this.send("Page.navigate", { url });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.ws.off("message", handler);
        reject(new Error("Page load timed out"));
      }, timeoutMs);

      const handler = (raw: WebSocket.RawData) => {
        const msg = JSON.parse(raw.toString());
        if (msg.method === "Page.loadEventFired") {
          clearTimeout(timer);
          this.ws.off("message", handler);
          resolve();
        }
      };
      this.ws.on("message", handler);
    });
  }

  async getCookies(domain: string): Promise<Cookie[]> {
    const result = (await this.send("Network.getCookies", {
      urls: [`https://${domain}`],
    })) as { cookies: Cookie[] };
    return result.cookies;
  }

  async fetchConversation(conversationId: string): Promise<unknown> {
    return this.evaluate(`
      (function() {
        var m = document.cookie.match(/lastActiveOrg=([^;]+)/);
        if (!m) throw new Error("Not logged in: lastActiveOrg cookie missing");
        return fetch("/api/organizations/" + m[1] +
              "/chat_conversations/" + ${JSON.stringify(conversationId)} + "?tree=true&rendering_mode=messages&render_all_tools=true",
              { credentials: "include", headers: { "Content-Type": "application/json" } })
          .then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
      })()
    `);
  }

  async fetchImageAsDataUrl(url: string): Promise<string | null> {
    const fullUrl = url.startsWith("http") ? url : `https://claude.ai${url}`;
    return this.evaluate(`
      fetch(${JSON.stringify(fullUrl)}, { credentials: "include" })
        .then(r => r.ok ? r.blob() : null)
        .then(b => b && new Promise(resolve => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(b);
        }))
    `) as Promise<string | null>;
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.ws.close();
    }
  }
}
