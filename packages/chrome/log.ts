let enabled = false;

function debug(...args: unknown[]): void {
  if (enabled) console.log("[claude-exporter]", ...args);
}

debug.enable = () => { enabled = true; };

export default debug;
