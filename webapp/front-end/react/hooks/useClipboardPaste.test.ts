import { describe, expect, it, vi } from "vitest";

import { getClipboardImage } from "./useClipboardPaste";

function clipboardData({
  items = [],
  files = [],
}: {
  items?: Partial<DataTransferItem>[];
  files?: File[];
}): DataTransfer {
  return {
    items,
    files,
  } as unknown as DataTransfer;
}

describe("getClipboardImage", () => {
  it("returns an image supplied as a clipboard item", () => {
    const image = new File(["pixels"], "clipboard.png", { type: "image/png" });
    const getAsFile = vi.fn(() => image);
    const data = clipboardData({
      items: [{ kind: "file", type: "image/png", getAsFile }],
    });

    expect(getClipboardImage(data)).toBe(image);
    expect(getAsFile).toHaveBeenCalledOnce();
  });

  it("falls back to clipboard files", () => {
    const image = new File(["pixels"], "clipboard.webp", { type: "image/webp" });
    const data = clipboardData({
      items: [{ kind: "string", type: "text/plain" }],
      files: [new File(["notes"], "notes.txt", { type: "text/plain" }), image],
    });

    expect(getClipboardImage(data)).toBe(image);
  });

  it("ignores non-image clipboard data", () => {
    const data = clipboardData({
      items: [{ kind: "string", type: "text/plain" }],
      files: [new File(["notes"], "notes.txt", { type: "text/plain" })],
    });

    expect(getClipboardImage(data)).toBeNull();
    expect(getClipboardImage(null)).toBeNull();
  });
});
