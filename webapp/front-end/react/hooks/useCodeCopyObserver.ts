import { useEffect, useRef } from "react";

async function copyCodeToClipboard(codeElement: HTMLElement): Promise<void> {
  const codeText = codeElement?.textContent;
  if (!codeText) {
    throw new Error("Nothing to copy");
  }

  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(codeText);
  }

  return new Promise((resolve, reject) => {
    const textArea = document.createElement("textarea");
    textArea.value = codeText;
    textArea.setAttribute("readonly", "");
    textArea.style.position = "absolute";
    textArea.style.left = "-9999px";
    document.body.appendChild(textArea);

    const selection = document.getSelection();
    const originalRange =
      selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

    textArea.select();
    textArea.setSelectionRange(0, textArea.value.length);

    try {
      const successful = document.execCommand("copy");
      document.body.removeChild(textArea);
      if (originalRange) {
        selection!.removeAllRanges();
        selection!.addRange(originalRange);
      }
      if (successful) {
        resolve();
      } else {
        reject(new Error("Copy command was unsuccessful"));
      }
    } catch (error) {
      document.body.removeChild(textArea);
      if (originalRange) {
        selection!.removeAllRanges();
        selection!.addRange(originalRange);
      }
      reject(error);
    }
  });
}

function addCopyButtonsToCodeBlocks(container: HTMLElement | null) {
  if (!container) return;

  const codeBlocks = container.querySelectorAll("pre > code");
  codeBlocks.forEach((codeElement) => {
    const preElement = codeElement.parentElement;
    if (!preElement || preElement.dataset.copyButtonAttached === "true") {
      return;
    }

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "code-copy-button";
    copyButton.textContent = "Copy";
    copyButton.setAttribute("aria-label", "Copy code to clipboard");

    copyButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      copyButton.disabled = true;
      copyCodeToClipboard(codeElement as HTMLElement)
        .then(() => {
          copyButton.textContent = "Copied!";
          setTimeout(() => {
            copyButton.textContent = "Copy";
            copyButton.disabled = false;
          }, 2000);
        })
        .catch(() => {
          copyButton.textContent = "Error";
          setTimeout(() => {
            copyButton.textContent = "Copy";
            copyButton.disabled = false;
          }, 2000);
        });
    });

    preElement.dataset.copyButtonAttached = "true";
    preElement.classList.add("code-block-with-copy");
    preElement.appendChild(copyButton);
  });
}

/**
 * MutationObserver that watches a container ref and adds copy buttons to code blocks.
 */
export default function useCodeCopyObserver(
  containerRef: React.RefObject<HTMLElement | null>
) {
  const observerRef = useRef<MutationObserver | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Add buttons to existing code blocks
    addCopyButtonsToCodeBlocks(container);

    // Watch for new code blocks
    observerRef.current = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          addCopyButtonsToCodeBlocks(container);
          break;
        }
      }
    });

    observerRef.current.observe(container, {
      childList: true,
      subtree: true,
    });

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, [containerRef]);

  // Expose for manual triggering
  return {
    addCopyButtons: () => addCopyButtonsToCodeBlocks(containerRef.current),
  };
}
