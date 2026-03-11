import { useRef, useCallback } from "react";

interface StreamingChatOptions {
  chatEndpoint: string;
  controlValue: string;
  onStreamStart: () => void;
  onStreamChunk: (content: string, buffer: string) => void;
  onStreamEnd: (result: string, buffer: string) => void;
  onStreamError: (error: Error) => void;
  onAbort: (hasContent: boolean) => void;
  setWaiting: (waiting: boolean) => void;
  setIsGenerating: (generating: boolean) => void;
}

export default function useStreamingChat() {
  const abortControllerRef = useRef<AbortController | null>(null);

  const isGenerating = abortControllerRef.current !== null;

  const sendMessage = useCallback(
    async (payload: Record<string, any>, options: StreamingChatOptions) => {
      const {
        chatEndpoint,
        controlValue,
        onStreamStart,
        onStreamChunk,
        onStreamEnd,
        onStreamError,
        onAbort,
        setWaiting,
        setIsGenerating,
      } = options;

      // Set waiting after a small delay
      const waitingTimeout = setTimeout(() => {
        setWaiting(true);
      }, 500);

      const formData = new FormData();
      for (const key in payload) {
        if (Object.prototype.hasOwnProperty.call(payload, key)) {
          formData.append(key, payload[key]);
        }
      }

      // Abort any existing request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      setIsGenerating(true);

      let start: number | null = null;
      let buffer = "";
      let hasLoggedThinking = false;

      onStreamStart();

      fetch(chatEndpoint, {
        method: "POST",
        headers: {
          Responsetype: "stream",
        },
        body: formData,
        signal: abortController.signal,
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error("Network response was not ok");
          }

          const reader = response.body!.getReader();
          const decoder = new TextDecoder("utf-8");

          return new ReadableStream({
            start(controller) {
              function push() {
                reader
                  .read()
                  .then(({ done, value }) => {
                    if (done) {
                      controller.close();
                      return;
                    }

                    clearTimeout(waitingTimeout);
                    setWaiting(false);

                    // Record when first chunk arrives for speed calculation
                    if (start === null) {
                      start = Date.now();
                    }

                    const content = decoder.decode(value, { stream: true });
                    buffer += content;

                    if (!buffer.startsWith(controlValue)) {
                      // Strip thinking blocks from visible output
                      let cleanedContent = buffer;
                      cleanedContent = cleanedContent.replace(
                        /<(?:think|thought|thought_process|redacted_reasoning)\s*>[\s\S]*?<\/(?:think|thought|thought_process|redacted_reasoning)\s*>/gi,
                        ""
                      );
                      cleanedContent = cleanedContent.replace(
                        /<(?:think|thought|thought_process|redacted_reasoning)\s*>[\s\S]*$/gi,
                        ""
                      );

                      onStreamChunk(cleanedContent, buffer);

                      // Log thinking to console once completed
                      if (!hasLoggedThinking) {
                        const thinkMatch = buffer.match(
                          /<(?:think|thought|thought_process|redacted_reasoning)\s*>([\s\S]*?)<\/(?:think|thought|thought_process|redacted_reasoning)\s*>/i
                        );
                        if (thinkMatch) {
                          console.log(
                            "%cAI Thought Process:",
                            "color: #888; font-style: italic; font-weight: bold;"
                          );
                          console.log(thinkMatch[1].trim());
                          hasLoggedThinking = true;
                        }
                      }
                    }

                    controller.enqueue(value);
                    push();
                  })
                  .catch((error) => {
                    if (error.name === "AbortError") {
                      controller.close();
                      return;
                    }
                    console.error(error);
                    controller.error(error);
                  });
              }
              push();
            },
          });
        })
        .then((stream) => {
          return new Response(stream).text();
        })
        .then((result) => {
          const elapsed = Date.now() - start!;
          const wordCount = result.trim().split(/\s+/).length;
          const speed = Math.round(wordCount / (elapsed / 1000));
          console.log(`Speed: ${speed} t/s`);

          onStreamEnd(result, buffer);
        })
        .catch((exception) => {
          if (exception.name === "AbortError") {
            onAbort(buffer.length > 0);
            return;
          }
          onStreamError(exception);
        })
        .finally(() => {
          clearTimeout(waitingTimeout);
          setWaiting(false);
          if (abortControllerRef.current === abortController) {
            abortControllerRef.current = null;
            setIsGenerating(false);
          }
        });
    },
    []
  );

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  return { sendMessage, stopGeneration, isGenerating, abortControllerRef };
}
