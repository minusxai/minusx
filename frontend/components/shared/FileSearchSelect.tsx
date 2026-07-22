'use client';

import { useMemo, useState } from 'react';

interface FileSearchSelectProps {
  files: { id: number; name: string }[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  placeholder?: string;
}

/** Searchable file selector — renders a combobox for picking a file by name. */
export default function FileSearchSelect({ files, selectedId, onSelect, placeholder }: FileSearchSelectProps) {
  const [inputValue, setInputValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);

  const filteredItems = useMemo(() => {
    const lower = inputValue.toLowerCase();
    const filtered = lower
      ? files.filter(f => f.name.toLowerCase().includes(lower))
      : files;
    return filtered.filter(f => f.id != null).map(f => ({ value: String(f.id), label: f.name }));
  }, [files, inputValue]);

  const selectedName = useMemo(
    () => files.find(f => f.id === selectedId)?.name ?? '',
    [files, selectedId]
  );

  const commit = (value: string) => {
    if (value) onSelect(parseInt(value, 10));
    setInputValue('');
    setIsOpen(false);
  };

  const open = () => {
    setHighlighted(0);
    setIsOpen(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) open();
      else setHighlighted(h => Math.min(h + 1, filteredItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      // Auto-highlight behavior: Enter picks the highlighted (first by default) match
      const item = filteredItems[highlighted];
      if (isOpen && item) commit(item.value);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div className="relative">
      <input
        value={isOpen ? inputValue : (inputValue || selectedName)}
        placeholder={placeholder || 'Search...'}
        onChange={(e) => {
          setInputValue(e.target.value);
          setHighlighted(0);
          setIsOpen(true);
        }}
        onFocus={open}
        onClick={(e) => { e.stopPropagation(); open(); }}
        onBlur={() => setTimeout(() => { setIsOpen(false); setInputValue(''); }, 150)}
        onKeyDown={handleKeyDown}
        className="flex h-8 w-full min-w-0 rounded-md border border-input bg-card px-2.5 py-1 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      />
      {isOpen && (
        <div className="absolute top-full left-0 z-50 mt-0.5 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
          {filteredItems.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">No results found</div>
          )}
          {filteredItems.map((item, i) => (
            <div
              key={item.value}
              className={`flex cursor-default items-center justify-between rounded-sm px-2 py-1.5 text-sm select-none ${
                i === highlighted ? 'bg-accent text-accent-foreground' : ''
              }`}
              onMouseEnter={() => setHighlighted(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                commit(item.value);
              }}
            >
              <span>{item.label}</span>
              {selectedId != null && item.value === String(selectedId) && (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3.5 shrink-0">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
