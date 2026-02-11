'use client';

import React, { useState } from 'react';
import { DayPicker } from 'react-day-picker';
import { Box, Portal, Input, IconButton, HStack } from '@chakra-ui/react';
import { LuCalendar } from 'react-icons/lu';
import { useAppSelector } from '@/store/hooks';
import 'react-day-picker/dist/style.css';

interface DatePickerProps {
  value: string | undefined;
  onChange: (value: string) => void;
  placeholder?: string;
}

export default function DatePicker({ value, onChange, placeholder = 'YYYY-MM-DD' }: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [buttonRef, setButtonRef] = useState<HTMLDivElement | null>(null);
  const [inputValue, setInputValue] = useState(value || '');
  const colorMode = useAppSelector((state) => state.ui.colorMode);
  const isDark = colorMode === 'dark';

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
            boxShadow: '0 0 0 1px var(--chakra-colors-accent-teal)',
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
                bg={isDark ? 'accent.muted' : 'white'}
                borderRadius="md"
                border="1px solid"
                borderColor={isDark ? 'accent.muted' : 'accent.muted'}
                shadow="lg"
                p={4}
                style={{
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                <style>{`
                  .rdp {
                    --rdp-cell-size: 40px;
                    --rdp-accent-color: #16a085;
                    --rdp-background-color: ${isDark ? '#2d3748' : '#e2e8f0'};
                    font-family: "JetBrains Mono", monospace;
                  }
                  .rdp-months {
                    color: ${isDark ? '#ffffff' : '#1a202c'};
                    font-family: "JetBrains Mono", monospace;
                  }
                  .rdp-caption {
                    color: ${isDark ? '#ffffff' : '#1a202c'};
                    font-weight: 800;
                    font-size: 0.875rem;
                    margin-bottom: 12px;
                    font-family: "JetBrains Mono", monospace;
                    letter-spacing: 0.02em;
                  }
                  .rdp-caption_label {
                    font-family: "JetBrains Mono", monospace;
                  }
                  .rdp-head_cell {
                    color: ${isDark ? '#a0aec0' : '#718096'};
                    font-weight: 700;
                    font-size: 0.75rem;
                    text-transform: uppercase;
                    font-family: "JetBrains Mono", monospace;
                    letter-spacing: 0.05em;
                  }
                  .rdp-cell {
                    color: ${isDark ? '#ffffff' : '#1a202c'};
                    font-family: "JetBrains Mono", monospace;
                  }
                  .rdp-day {
                    border-radius: 0.25rem;
                    font-size: 0.875rem;
                    font-weight: 600;
                    transition: all 0.2s;
                    font-family: "JetBrains Mono", monospace;
                  }
                  .rdp-day:hover:not(.rdp-day_selected) {
                    background-color: ${isDark ? '#2d3748' : '#e2e8f0'};
                    color: #16a085;
                  }
                  .rdp-selected .rdp-day_button {
                    border: 2px solid #16a085;
                  }
                  .rdp-day_selected {
                    background-color: #16a085 !important;
                    color: white !important;
                    font-weight: 800
                  }
                  .rdp-today:not(.rdp-outside) {
                    color : #16a085;
                  }
                  .rdp-day_selected:hover {
                    background-color: #16a085 !important;
                    color: white !important;
                  }
                  button.rdp-day_selected {
                    background-color: #16a085 !important;
                    color: white !important;
                  }
                  .rdp-day_today:not(.rdp-day_selected) {
                    background-color: ${isDark ? '#2d3748' : '#e2e8f0'};
                    color: #16a085;
                    font-weight: 800;
                  }
                  .rdp-button:disabled {
                    color: #718096;
                    opacity: 0.5;
                  }
                  .rdp-nav_button {
                    color: #16a085 !important;
                    font-weight: 700;
                  }
                  .rdp-nav_button:hover {
                    background-color: ${isDark ? '#2d3748' : '#e2e8f0'};
                  }
                  .rdp-nav_button svg {
                    color: #16a085 !important;
                    fill: #16a085 !important;
                  }
                  .rdp-chevron {
                    fill: #16a085 !important;
                    color: #16a085 !important;
                  }
                  .rdp-nav_button_previous svg,
                  .rdp-nav_button_next svg {
                    color: #16a085 !important;
                    fill: #16a085 !important;
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
