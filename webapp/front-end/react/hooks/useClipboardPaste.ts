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
  onURL: (url: string) => void;
  onLongText: (text: string, nextId: number) => void;
  onShortText: (text: string) => void;
  getNextId: () => number;
}

/**
 * Handles paste events: detects URLs, long text (>200 chars) for clipboard, or appends short text to prompt.
 */
export default function useClipboardPaste(options: UseClipboardPasteOptions) {
  const { onURL, onLongText, onShortText, getNextId } = options;

  useEffect(() => {
    function handlePaste(event: ClipboardEvent) {
      event.preventDefault();
      const paste = (event.clipboardData || (window as any).clipboardData).getData(
        "text"
      );

      if (isValidURL(paste)) {
        onURL(paste);
        return;
      }

      if (paste.length > 200) {
        onLongText(paste, getNextId());
      } else {
        onShortText(paste);
      }
    }

    window.addEventListener("paste", handlePaste as EventListener);
    return () => {
      window.removeEventListener("paste", handlePaste as EventListener);
    };
  }, [onURL, onLongText, onShortText, getNextId]);
}
