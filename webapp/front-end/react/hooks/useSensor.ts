import { useRef, useCallback, useState, useEffect } from "react";

interface UseSensorOptions {
  sensorUri: string;
  onSensorData: (data: any) => void;
}

export default function useSensor(options: UseSensorOptions) {
  const { sensorUri, onSensorData } = options;
  const eventSourceRef = useRef<EventSource | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<string>("");

  const closeConnection = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setConnectionStatus("");
    }
  }, []);

  const initEventSource = useCallback(() => {
    const es = new EventSource(sensorUri);
    eventSourceRef.current = es;

    es.onmessage = (event) => {
      const data = JSON.parse(event.data);
      onSensorData(data);
    };

    es.onopen = () => {
      setConnectionStatus("Connected");
    };

    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) {
        setConnectionStatus("");
      } else {
        setConnectionStatus("Error");
      }
    };
  }, [sensorUri, onSensorData]);

  const toggleSensor = useCallback(
    (enabled: boolean) => {
      if (enabled) {
        initEventSource();
      } else {
        closeConnection();
      }
    },
    [initEventSource, closeConnection]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      closeConnection();
    };
  }, [closeConnection]);

  return { toggleSensor, connectionStatus };
}
