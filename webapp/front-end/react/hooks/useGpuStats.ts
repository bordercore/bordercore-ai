import { useRef, useCallback, useEffect, useState } from "react";

export interface GpuStats {
  gpu_util: number;
  mem_used: number;
  mem_total: number;
  mem_percent: number;
  temperature: number;
  power_draw: number;
  power_limit: number;
  clock_mhz: number;
  error?: string;
}

const DEFAULT_STATS: GpuStats = {
  gpu_util: 0,
  mem_used: 0,
  mem_total: 1,
  mem_percent: 0,
  temperature: 30,
  power_draw: 0,
  power_limit: 350,
  clock_mhz: 0,
};

interface UseGpuStatsOptions {
  active: boolean;
}

export default function useGpuStats({ active }: UseGpuStatsOptions) {
  const statsRef = useRef<GpuStats>(DEFAULT_STATS);
  const eventSourceRef = useRef<EventSource | null>(null);
  const [available, setAvailable] = useState(false);

  const close = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!active) {
      close();
      return;
    }

    const es = new EventSource("/gpu/stats");
    eventSourceRef.current = es;

    let errorCount = 0;

    es.onmessage = (event) => {
      errorCount = 0;
      try {
        const data: GpuStats = JSON.parse(event.data);
        if (data.error) {
          setAvailable(false);
        } else {
          statsRef.current = data;
          setAvailable(true);
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      errorCount++;
      setAvailable(false);
      if (errorCount > 5) {
        es.close();
        eventSourceRef.current = null;
      }
    };

    return () => {
      close();
    };
  }, [active, close]);

  return { statsRef, available };
}
