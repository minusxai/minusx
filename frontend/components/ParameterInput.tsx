'use client';

import React from 'react';
import { Input, HStack, Text, MenuRoot, MenuTrigger, MenuContent, MenuItem, Portal, MenuPositioner, Box, IconButton } from '@chakra-ui/react';
import { LuChevronDown, LuX } from 'react-icons/lu';
import { QuestionParameter } from '@/lib/types';
import { getTypeColor, getTypeColorHex, getTypeIcon } from '@/lib/sql/sql-params';
import DatePicker from './DatePicker';

interface ParameterInputProps {
  parameter: QuestionParameter;
  value: string | number | undefined;
  onChange: (value: string | number) => void;
  onTypeChange: (type: 'text' | 'number' | 'date') => void;
  onSubmit?: (paramName?: string, value?: string | number) => void;
  disableTypeChange?: boolean;
  onHoverParam?: (key: string | null) => void;
}

export default function ParameterInput({
  parameter,
  value,
  onChange,
  onTypeChange,
  onSubmit,
  disableTypeChange = false,
  onHoverParam,
}: ParameterInputProps) {
  const paramKey = `${parameter.name}-${parameter.type}`;
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parameter.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value;
    onChange(newValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Handle Enter with any modifier (or alone)
    if (e.key === 'Enter' && onSubmit) {
      e.preventDefault();
      e.stopPropagation();

      // Get the current value from the input
      const currentValue = parameter.type === 'number'
        ? parseFloat(e.currentTarget.value) || 0
        : e.currentTarget.value;

      onSubmit(parameter.name, currentValue);
    }
  };

  const handleDateChange = (newValue: string) => {
    onChange(newValue);
    // Auto-submit on date change (since date picker doesn't use Enter key)
    if (onSubmit) {
      onSubmit(parameter.name, newValue);
    }
  };

  const typeOptions: Array<{ type: 'text' | 'number' | 'date'; label: string }> = [
    { type: 'text', label: 'Text' },
    { type: 'number', label: 'Number' },
    { type: 'date', label: 'Date' },
  ];

  return (
    <Box
      position="relative"
      p={2}
      pt={4}
      bg="bg.muted"
      borderRadius="md"
      border="1px solid"
      borderColor="border.default"
      onMouseEnter={() => onHoverParam?.(paramKey)}
      onMouseLeave={() => onHoverParam?.(null)}
    >
      {/* Parameter name - top left */}
      <Text
        position="absolute"
        top={-2}
        left={2}
        fontSize="xs"
        fontWeight="600"
        color="white"
        fontFamily="mono"
        bg={getTypeColor(parameter.type)}
        borderRadius={5}
        px={2}
      >
        :{parameter.name}
      </Text>

      <HStack gap={2} align="stretch">

      {/* Input field */}
      {parameter.type === 'date' ? (
        <DatePicker
          value={typeof value === 'string' ? value : (parameter.value as string) ?? ''}
          onChange={handleDateChange}
          placeholder="YYYY-MM-DD"
        />
      ) : (
        <Input
          value={value ?? parameter.value ?? ''}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          type={parameter.type === 'number' ? 'number' : 'text'}
          size="md"
          minW="100px"
          maxW="150px"
          bg="bg.canvas"
          borderColor="border.muted"
          fontFamily={parameter.type === 'number' ? 'mono' : 'inherit'}
          fontSize="sm"
          px={3}
          py={2}
          _focus={{
            borderColor: 'accent.teal',
            boxShadow: '0 0 0 1px var(--chakra-colors-accent-teal)',
          }}
          placeholder={parameter.type === 'number' ? '0' : 'value'}
        />
      )}

      {/* Clear button */}
      {value !== undefined && value !== '' && value !== null && (
        <IconButton
          aria-label="Clear value"
          size="sm"
          variant="ghost"
          onClick={() => onChange('')}
          color="fg.muted"
          _hover={{
            bg: 'bg.muted',
            color: 'accent.danger',
          }}
        >
          <LuX size={16} />
        </IconButton>
      )}

      {/* Type selector - dropdown or read-only indicator */}
      {disableTypeChange ? (
        <HStack
          gap={1}
          px={2}
          py={1}
          bg="bg.canvas"
          borderRadius="sm"
          border="1px solid"
          borderColor="border.muted"
          fontSize="xs"
          fontWeight="600"
          style={{ color: getTypeColorHex(parameter.type) }}
        >
          {React.createElement(getTypeIcon(parameter.type), { size: 16 })}
        </HStack>
      ) : (
        <MenuRoot positioning={{ placement: 'bottom' }}>
          <MenuTrigger asChild>
            <HStack
              as="button"
              gap={1}
              px={2}
              py={1}
              bg="bg.canvas"
              borderRadius="sm"
              border="1px solid"
              borderColor="border.muted"
              cursor="pointer"
              fontSize="xs"
              fontWeight="600"
              style={{ color: getTypeColorHex(parameter.type) }}
              _hover={{
                bg: 'bg.surface',
                borderColor: 'accent.teal',
              }}
            >
              {React.createElement(getTypeIcon(parameter.type), { size: 16 })}
              <LuChevronDown size={12} />
            </HStack>
          </MenuTrigger>
          <Portal>
            <MenuPositioner>
              <MenuContent minW="120px" p={1}>
                {typeOptions.map((option) => (
                  <MenuItem
                    key={option.type}
                    value={option.type}
                    style={{ color: getTypeColorHex(option.type) }}
                    onClick={() => onTypeChange(option.type)}
                    px={3}
                    py={2}
                    borderRadius="sm"
                  >
                    <HStack gap={2}>
                      {React.createElement(getTypeIcon(option.type), { size: 16 })}
                      <Text fontSize="sm" fontWeight="600" fontFamily="mono">
                        {option.label}
                      </Text>
                    </HStack>
                  </MenuItem>
                ))}
              </MenuContent>
            </MenuPositioner>
          </Portal>
        </MenuRoot>
      )}
      </HStack>
    </Box>
  );
}
