import { useEffect } from "react";

function isValidURL(string: string): boolean {
  try {
    new URL(string);
    return true;
  } catch {
    return false;
  }
}

interface UseClipboardPasteOptions {
  onImage?: (image: File) => boolean;
  onURL: (url: string) => void;
  onLongText: (text: string, nextId: number) => void;
  onShortText: (text: string) => void;
  getNextId: () => number;
}

export function getClipboardImage(clipboardData: DataTransfer | null): File | null {
  if (!clipboardData) return null;

  for (const item of Array.from(clipboardData.items)) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const image = item.getAsFile();
      if (image) return image;
    }
  }

  return Array.from(clipboardData.files).find(file => file.type.startsWith("image/")) || null;
}

/**
 * Handles paste events: detects images, URLs, long text (>10 lines), or appends short text to prompt.
 */
export default function useClipboardPaste(options: UseClipboardPasteOptions) {
  const { onImage, onURL, onLongText, onShortText, getNextId } = options;

  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      const image = getClipboardImage(event.clipboardData);
      if (image && onImage?.(image)) {
        event.preventDefault();
        return;
      }

      event.preventDefault();
      const paste = (event.clipboardData || (window as any).clipboardData).getData("text");

      if (isValidURL(paste)) {
        onURL(paste);
        return;
      }

      const lineCount = paste.split("\n").length;
      if (lineCount > 10) {
        onLongText(paste, getNextId());
      } else {
        onShortText(paste);
      }
    }

    window.addEventListener("paste", handlePaste as EventListener);
    return () => {
      window.removeEventListener("paste", handlePaste as EventListener);
    };
  }, [onImage, onURL, onLongText, onShortText, getNextId]);
}
