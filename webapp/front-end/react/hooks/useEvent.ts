import { useEffect } from "react";

interface UseEventOptions {
  target?: EventTarget;
  id?: string;
  [key: string]: any;
}

/**
 * Attach a DOM event listener on mount, remove on unmount.
 */
export default function useEvent(
  event: string,
  handler: EventListener,
  options: UseEventOptions = {}
) {
  const { target = window, id, ...listenerOptions } = options;

  useEffect(() => {
    const resolvedTarget = id ? document.getElementById(id) : target;
    if (!resolvedTarget) return;

    resolvedTarget.addEventListener(event, handler, listenerOptions);
    return () => {
      resolvedTarget.removeEventListener(event, handler, listenerOptions);
    };
  }, [event, handler, id]);
}
