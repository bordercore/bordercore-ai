import React, { useEffect, useState, useCallback, useRef } from "react";
import { EventBus } from "../utils/reactUtils";

interface ToastData {
  id: number;
  title: string;
  body: string;
  variant: "danger" | "warning" | "info";
  autoHide?: boolean;
}

const VARIANT_STYLES: Record<string, { border: string; icon: string; glow: string }> = {
  danger: {
    border: "rgba(239, 68, 68, 0.4)",
    icon: "\u2718",
    glow: "rgba(239, 68, 68, 0.15)",
  },
  warning: {
    border: "rgba(245, 158, 11, 0.4)",
    icon: "\u26A0",
    glow: "rgba(245, 158, 11, 0.15)",
  },
  info: {
    border: "rgba(0, 234, 255, 0.4)",
    icon: "\u2714",
    glow: "rgba(0, 234, 255, 0.15)",
  },
};

export default function ToastContainer() {
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const nextId = useRef(0);

  const addToast = useCallback((data: Omit<ToastData, "id">) => {
    const id = nextId.current++;
    setToasts((prev) => {
      const next = [...prev, { ...data, id }];
      return next.length > 5 ? next.slice(-5) : next;
    });

    if (data.autoHide !== false) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 5000);
    }
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    EventBus.$on("toast", addToast);
    return () => EventBus.$off("toast", addToast);
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="notify-container">
      {toasts.map((toast) => {
        const style = VARIANT_STYLES[toast.variant] || VARIANT_STYLES.info;
        return (
          <div
            key={toast.id}
            className={`notify-item notify-${toast.variant}`}
            style={{
              borderColor: style.border,
              boxShadow: `0 4px 24px ${style.glow}`,
            }}
          >
            <span className="notify-icon">{style.icon}</span>
            <div className="notify-content">
              <div className="notify-title">{toast.title}</div>
              <div className="notify-body">{toast.body}</div>
            </div>
            <button
              className="notify-close"
              onClick={() => removeToast(toast.id)}
              aria-label="Dismiss"
            >
              {"\u00D7"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
