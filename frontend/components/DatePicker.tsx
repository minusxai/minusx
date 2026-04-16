'use client';

import React, { useState } from 'react';
import { DayPicker } from 'react-day-picker';
import { Box, Portal, Input, IconButton, HStack } from '@chakra-ui/react';
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
    <Box position="relative">
      <HStack gap={0} ref={setButtonRef}>
        <Input
          value={inputValue}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          onKeyDown={handleInputKeyDown}
          placeholder={placeholder}
          aria-label={ariaLabel}
          size="md"
          minW="120px"
          maxW="150px"
          bg="bg.canvas"
          borderColor="border.muted"
          borderRightRadius={0}
          fontFamily="mono"
          fontSize="sm"
          px={3}
          py={2}
          _focus={{
            borderColor: 'accent.teal',
            boxShadow: '0 0 0 1px #16a085',
          }}
        />
        <IconButton
          aria-label="Open calendar"
          size="md"
          variant="outline"
          onClick={() => setIsOpen(!isOpen)}
          borderLeftRadius={0}
          borderLeft="none"
          bg="bg.canvas"
          borderColor="border.muted"
          color="fg.muted"
          _hover={{
            bg: 'bg.muted',
            color: 'accent.teal',
          }}
        >
          <LuCalendar size={16} />
        </IconButton>
      </HStack>

      {isOpen && (
        <>
          {/* Backdrop */}
          <Box
            position="fixed"
            top="0"
            left="0"
            right="0"
            bottom="0"
            zIndex="50"
            onClick={() => setIsOpen(false)}
          />
          {/* Calendar */}
          <Portal>
            <Box
              position="fixed"
              zIndex="100"
              style={{
                top: buttonRef ? `${buttonRef.getBoundingClientRect().bottom + 4}px` : '0',
                left: buttonRef ? `${buttonRef.getBoundingClientRect().left}px` : '0',
              }}
            >
              <Box
                bg="bg.canvas"
                borderRadius="md"
                border="1px solid"
                borderColor="border.muted"
                shadow="lg"
                p={4}
                color="fg.default"
                style={{
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                <style>{`
                  .rdp {
                    --rdp-cell-size: 40px;
                    --rdp-accent-color: #16a085;
                    --rdp-accent-background-color: #16a085;
                    --rdp-selected-border: 2px solid #16a085;
                    --rdp-today-color: #16a085;
                    font-family: "JetBrains Mono", monospace;
                    color: var(--chakra-colors-fg-default);
                  }
                  .rdp-day {
                    border-radius: 0.25rem;
                    font-size: 0.875rem;
                    font-weight: 600;
                    transition: all 0.2s;
                    font-family: "JetBrains Mono", monospace;
                  }
                  .rdp-day:hover:not(.rdp-selected) {
                    background-color: var(--chakra-colors-bg-muted);
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
                    background-color: var(--chakra-colors-bg-muted);
                  }
                  .rdp-weekday {
                    color: var(--chakra-colors-fg-muted);
                    font-weight: 700;
                    font-size: 0.75rem;
                    text-transform: uppercase;
                    font-family: "JetBrains Mono", monospace;
                    letter-spacing: 0.05em;
                  }
                  .rdp-month_caption {
                    color: var(--chakra-colors-fg-default);
                    font-weight: 800;
                    font-size: 0.875rem;
                    font-family: "JetBrains Mono", monospace;
                    letter-spacing: 0.02em;
                  }
                  .rdp-today:not(.rdp-outside) {
                    color: #16a085 !important;
                  }
                  .rdp-disabled:not(.rdp-selected) {
                    color: var(--chakra-colors-fg-muted);
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
              </Box>
            </Box>
          </Portal>
        </>
      )}
    </Box>
  );
}
