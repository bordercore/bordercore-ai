import { useCallback, useEffect, useRef, useState } from "react";

import { discoverTtsCapabilities, TtsCapabilityState } from "../utils/ttsCapabilities";

const INITIAL_STATE: TtsCapabilityState = {
  readiness: "loading",
  capabilities: null,
  voices: [],
  message: "Checking TTS server…",
};

export default function useTtsCapabilities(host: string, fallbackVoices: string[]) {
  const [state, setState] = useState<TtsCapabilityState>(INITIAL_STATE);
  const [resolvedHost, setResolvedHost] = useState("");
  const [refreshGeneration, setRefreshGeneration] = useState(0);
  const forceRefreshRef = useRef(false);

  const refresh = useCallback(() => {
    forceRefreshRef.current = true;
    setRefreshGeneration(generation => generation + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const forceRefresh = forceRefreshRef.current;
    forceRefreshRef.current = false;
    setResolvedHost("");
    setState({
      ...INITIAL_STATE,
      voices: fallbackVoices,
    });

    discoverTtsCapabilities(host, {
      fallbackVoices,
      forceRefresh,
      signal: controller.signal,
    })
      .then(result => {
        setState(result);
        setResolvedHost(host);
      })
      .catch(error => {
        if ((error as Error).name !== "AbortError") {
          setState({
            readiness: "failed",
            capabilities: null,
            voices: fallbackVoices,
            message: "TTS capability request failed",
          });
        }
      });

    return () => controller.abort();
  }, [host, fallbackVoices, refreshGeneration]);

  const currentState =
    resolvedHost === host
      ? state
      : {
          ...INITIAL_STATE,
          voices: fallbackVoices,
        };
  return { ...currentState, resolvedHost, refresh };
}
