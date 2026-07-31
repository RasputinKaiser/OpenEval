"use client";

import { useRef } from "react";
import { ArrowDownWideNarrow, Filter, Search } from "lucide-react";
import { useFocusOnSlash } from "@/lib/use-focus-slash";
import { FILTER_MODES, SORT_MODES, type FilterMode, type SortMode } from "./live-shared";

function SelectPill({ icon: Icon, value, onChange, options, label }: { icon: any; value: string; onChange: (value: string) => void; options: ReadonlyArray<readonly [string, string]>; label: string }) {
  return (
    <label className="inline-flex min-h-10 max-w-full items-center gap-2 rounded-md border border-bd bg-bg-elev px-2.5 py-2 text-xs text-fg-muted">
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 max-w-[12rem] bg-transparent text-xs text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent"
        aria-label={label}
      >
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
    </label>
  );
}

export function SessionFilters({
  filter,
  sort,
  search,
  onFilterChange,
  onSortChange,
  onSearchChange,
}: {
  filter: FilterMode;
  sort: SortMode;
  search: string;
  onFilterChange: (filter: FilterMode) => void;
  onSortChange: (sort: SortMode) => void;
  onSearchChange: (search: string) => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  useFocusOnSlash(searchRef);
  return (
    <div className="flex min-w-0 flex-wrap gap-2">
      <SelectPill icon={Filter} label="Filter sessions" value={filter} onChange={(v) => onFilterChange(v as FilterMode)} options={FILTER_MODES} />
      <SelectPill icon={ArrowDownWideNarrow} label="Sort sessions" value={sort} onChange={(v) => onSortChange(v as SortMode)} options={SORT_MODES} />
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-fg-dim" />
        <input
          ref={searchRef}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search…"
          aria-label="Search sessions"
          className="min-h-10 w-36 min-w-0 flex-1 bg-bg pl-8 pr-2 text-[11px] border border-bd rounded-md focus:outline-none focus:border-accent focus-visible:ring-2 focus-visible:ring-accent sm:flex-none sm:w-32 lg:w-44 sm:focus:w-40 lg:focus:w-52 transition-[width,border-color] placeholder:text-fg-dim"
        />
      </div>
    </div>
  );
}
