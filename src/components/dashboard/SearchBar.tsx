/** @jsxImportSource react */
import { useEffect, useState } from "react";

interface SearchBarProps {
  placeholder?: string;
  filterSelector?: string;
}

export default function SearchBar({ placeholder = "Buscar...", filterSelector }: SearchBarProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!filterSelector) return;
    const items = document.querySelectorAll<HTMLElement>(filterSelector);
    const q = query.trim().toLowerCase();
    items.forEach((item) => {
      const text = item.textContent?.toLowerCase() ?? "";
      item.style.display = text.includes(q) ? "" : "none";
    });
  }, [query, filterSelector]);

  return (
    <div className="mb-6">
      <div className="relative">
        <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-zinc-500">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
        </span>
        <input
          className="w-full bg-surface border-border-custom rounded-custom pl-10 text-white placeholder-zinc-500 focus:ring-primary focus:border-primary py-2.5"
          placeholder={placeholder}
          type="text"
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
      </div>
    </div>
  );
}
