import React, { useEffect } from "react";

interface ModalProps {
  isOpen: boolean;
  onClose?: () => void;
  size?: "sm" | "lg";
  children: React.ReactNode;
}

export default function Modal({ isOpen, onClose, size = "sm", children }: ModalProps) {
  useEffect(() => {
    if (!isOpen || !onClose) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose!();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.5)",
        backdropFilter: "blur(4px)",
      }}
      onClick={onClose}
    >
      <div
        className="modal-content"
        style={{
          padding: "0.75rem",
          margin: "0 1rem",
          width: "100%",
          maxWidth: size === "sm" ? "24rem" : "32rem",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
