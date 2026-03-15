import React from "react";

const navItems = [
  { label: "Chat", link: "/" },
  { label: "RAG", link: "/rag" },
  { label: "Audio", link: "/audio" },
  { label: "Vision", link: "/vision" },
];

interface NavProps {
  active: string;
  onModeChange: (mode: string) => void;
}

export default function Nav({ active, onModeChange }: NavProps) {
  return (
    <div className="nav-tabs-custom">
      {navItems.map((item) => (
        <button
          key={item.link}
          className={`nav-tab${item.label === active ? " active" : ""}`}
          onClick={() => onModeChange(item.label)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
