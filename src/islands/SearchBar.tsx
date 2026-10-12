import { useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";

interface SearchBarProps {
  placeholder?: string;
  filterSelector?: string;
}

export default function SearchBar(
  { placeholder = "Buscar...", filterSelector }: SearchBarProps,
) {
  const query = useSignal("");

  useEffect(() => {
    if (!filterSelector) return;
    const items = document.querySelectorAll<HTMLElement>(filterSelector);
    const q = query.value.trim().toLowerCase();
    items.forEach((item) => {
      const text = item.textContent?.toLowerCase() ?? "";
      item.style.display = text.includes(q) ? "" : "none";
    });
  }, [query.value, filterSelector]);

  return (
    <div class="mb-6">
      <div class="relative">
        <span class="absolute inset-y-0 left-0 pl-3 flex items-center text-zinc-500">
          <svg
            class="h-5 w-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
            />
          </svg>
        </span>
        <input
          class="w-full bg-surface border-border-custom rounded-custom pl-10 text-white placeholder-zinc-500 focus:ring-primary focus:border-primary py-2.5"
          placeholder={placeholder}
          type="text"
          value={query.value}
          onInput={(e) => query.value = (e.target as HTMLInputElement).value}
        />
      </div>
    </div>
  );
}
