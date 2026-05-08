import { collectImages, sanitizeFilename } from "../converter/index.ts";
import type { Message } from "../converter/types.ts";
import type { CdpClient } from "../chrome/index.ts";

export interface ImageFile {
  msgIndex: number;
  filename: string;
  dataUrl: string;
}

export async function fetchAllImages(
  cdp: Pick<CdpClient, "fetchImageAsDataUrl">,
  messages: Message[],
  onStatus?: (msg: string) => void,
  signal?: AbortSignal,
): Promise<ImageFile[]> {
  const meta = collectImages(messages);
  const out: ImageFile[] = [];
  let seqNum = 0;

  for (const img of meta) {
    if (signal?.aborted) throw new Error("Cancelled");
    seqNum++;
    onStatus?.(`Fetching image ${seqNum}/${meta.length}...`);
    const dataUrl = await cdp.fetchImageAsDataUrl(img.url);
    if (!dataUrl) continue;
    const ext = img.fileName.match(/\.\w+$/)?.[0] || ".png";
    const base = sanitizeFilename(img.fileName.replace(/\.\w+$/, ""));
    const filename = `${String(seqNum).padStart(2, "0")}_${base}${ext}`;
    out.push({ msgIndex: img.msgIndex, filename, dataUrl });
  }
  return out;
}

export function decodeDataUrl(dataUrl: string): ArrayBuffer | null {
  const base64 = dataUrl.split(",")[1];
  if (!base64) return null;
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
