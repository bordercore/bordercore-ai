import React, { useState } from "react";

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
  const [activeTab, setActiveTab] = useState(active);

  function switchMode(mode: string) {
    setActiveTab(mode);
    onModeChange(mode);
  }

  return (
    <nav className="navbar navbar-expand-lg navbar-dark py-0">
      <ul className="navbar-nav mr-auto">
        {navItems.map((item) => (
          <li
            key={item.link}
            className={`nav-item${item.label === activeTab ? " active" : ""}`}
          >
            <span className="nav-link" onClick={() => switchMode(item.label)}>
              {item.label}
            </span>
          </li>
        ))}
      </ul>
    </nav>
  );
}
