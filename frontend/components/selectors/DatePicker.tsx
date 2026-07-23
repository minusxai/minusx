'use client';

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { DayPicker } from 'react-day-picker';
import { LuCalendar } from 'react-icons/lu';
import 'react-day-picker/dist/style.css';

interface DatePickerProps {
  value: string | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}

export default function DatePicker({ value, onChange, placeholder = 'YYYY-MM-DD', ariaLabel }: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [buttonRef, setButtonRef] = useState<HTMLDivElement | null>(null);
  const [inputValue, setInputValue] = useState(value || '');
  // Sync input value when prop changes
  React.useEffect(() => {
    setInputValue(value || '');
  }, [value]);

  // Parse date correctly - add 'T00:00:00' to avoid timezone issues
  const selectedDate = value ? new Date(value + 'T00:00:00') : undefined;

  const isValidDate = (dateString: string): boolean => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) return false;
    const date = new Date(dateString + 'T00:00:00');
    return date instanceof Date && !isNaN(date.getTime());
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handleInputBlur = () => {
    if (isValidDate(inputValue)) {
      onChange(inputValue);
    } else {
      // Revert to last valid value
      setInputValue(value || '');
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (isValidDate(inputValue)) {
        onChange(inputValue);
      } else {
        // Revert to last valid value
        setInputValue(value || '');
      }
    }
  };

  const handleSelect = (date: Date | undefined) => {
    if (date) {
      // Format in local timezone to avoid off-by-one errors
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const formattedDate = `${year}-${month}-${day}`;
      setInputValue(formattedDate);
      onChange(formattedDate);
      setIsOpen(false);
    }
  };

  return (
    <div className="relative">
      <div className="flex items-center" ref={setButtonRef}>
        <input
          value={inputValue}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          onKeyDown={handleInputKeyDown}
          placeholder={placeholder}
          aria-label={ariaLabel}
          className="h-10 min-w-[120px] max-w-[150px] rounded-l-md rounded-r-none border border-border bg-background px-3 py-2 font-mono text-sm outline-none placeholder:text-muted-foreground focus:border-[#16a085] focus:shadow-[0_0_0_1px_#16a085]"
        />
        <button
          aria-label="Open calendar"
          onClick={() => setIsOpen(!isOpen)}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-r-md rounded-l-none border border-l-0 border-border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-[#16a085]"
        >
          <LuCalendar size={16} />
        </button>
      </div>

      {isOpen && buttonRef && (
        <>
          {/* Backdrop + calendar — portaled to the ANCHOR's document body (Phase 8): inside the
              dashboard iframe surface the anchor rect is iframe-relative, so the top document.body
              is the wrong coordinate space — and fixed positioning is broken inside the
              <svg><foreignObject> surface, so the backdrop must escape it too. In the main
              document ownerDocument.body IS document.body (behavior unchanged). The calendar
              carries its own theme host so kit tokens resolve outside the app-shell host. */}
          {createPortal(
            <div
              className="fixed inset-0 z-50"
              onClick={() => setIsOpen(false)}
            />,
            buttonRef.ownerDocument.body
          )}
          {createPortal(
            <div data-mx-theme-host="">
              <div
                className="fixed z-[100]"
                style={{
                  top: buttonRef ? `${buttonRef.getBoundingClientRect().bottom + 4}px` : '0',
                  left: buttonRef ? `${buttonRef.getBoundingClientRect().left}px` : '0',
                }}
              >
                <div
                  className="rounded-md border border-border bg-background p-4 text-foreground shadow-lg"
                  style={{
                    fontFamily: 'var(--font-jetbrains-mono)',
                  }}
                >
                  <style>{`
                    .rdp {
                      --rdp-cell-size: 40px;
                      --rdp-accent-color: #16a085;
                      --rdp-accent-background-color: #16a085;
                      --rdp-selected-border: 2px solid #16a085;
                      --rdp-today-color: #16a085;
                      font-family: var(--font-jetbrains-mono);
                      color: var(--foreground);
                    }
                    .rdp-day {
                      border-radius: 0.25rem;
                      font-size: 0.875rem;
                      font-weight: 600;
                      transition: all 0.2s;
                      font-family: var(--font-jetbrains-mono);
                    }
                    .rdp-day:hover:not(.rdp-selected) {
                      background-color: var(--muted);
                      color: #16a085;
                    }
                    .rdp-selected,
                    .rdp-selected .rdp-day_button {
                      background-color: #16a085 !important;
                      color: white !important;
                      font-weight: 800;
                      border-radius: 0.25rem;
                      border: none;
                    }
                    .rdp-chevron {
                      fill: #16a085 !important;
                    }
                    .rdp-button_previous:hover,
                    .rdp-button_next:hover {
                      background-color: var(--muted);
                    }
                    .rdp-weekday {
                      color: var(--muted-foreground);
                      font-weight: 700;
                      font-size: 0.75rem;
                      text-transform: uppercase;
                      font-family: var(--font-jetbrains-mono);
                      letter-spacing: 0.05em;
                    }
                    .rdp-month_caption {
                      color: var(--foreground);
                      font-weight: 800;
                      font-size: 0.875rem;
                      font-family: var(--font-jetbrains-mono);
                      letter-spacing: 0.02em;
                    }
                    .rdp-today:not(.rdp-outside) {
                      color: #16a085 !important;
                    }
                    .rdp-disabled:not(.rdp-selected) {
                      color: var(--muted-foreground);
                      opacity: 0.5;
                    }
                  `}</style>
                  <DayPicker
                    mode="single"
                    selected={selectedDate}
                    onSelect={handleSelect}
                    showOutsideDays
                    captionLayout="dropdown"
                    fromYear={1900}
                    toYear={2100}
                  />
                </div>
              </div>
            </div>,
            buttonRef.ownerDocument.body
          )}
        </>
      )}
    </div>
  );
}
