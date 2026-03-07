'use client';

import React from 'react';
import { Input, HStack, Text, MenuRoot, MenuTrigger, MenuContent, MenuItem, Portal, MenuPositioner, Box, IconButton } from '@chakra-ui/react';
import { LuChevronDown, LuX } from 'react-icons/lu';
import { Tooltip } from '@/components/ui/tooltip';
import { QuestionParameter } from '@/lib/types';
import { getTypeColor, getTypeColorHex, getTypeIcon } from '@/lib/sql/sql-params';
import DatePicker from './DatePicker';

const ROW_H = '32px';

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
    if ((e.key === 'Enter' || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')) && onSubmit) {
      e.preventDefault();
      e.stopPropagation();
      const currentValue = parameter.type === 'number'
        ? parseFloat(e.currentTarget.value) || 0
        : e.currentTarget.value;
      onSubmit(parameter.name, currentValue);
    }
  };

  const handleDateChange = (newValue: string) => {
    onChange(newValue);
    if (onSubmit) {
      onSubmit(parameter.name, newValue);
    }
  };

  const hasValue = value !== undefined && value !== '' && value !== null;

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
      {/* Parameter name - floating label (top left) */}
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

      <HStack gap={1.5} align="center">

        {/* Input field */}
        {parameter.type === 'date' ? (
          <DatePicker
            value={typeof value === 'string' ? value : ''}
            onChange={handleDateChange}
            placeholder="YYYY-MM-DD"
          />
        ) : (
          <Input
            value={value ?? ''}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            type={parameter.type === 'number' ? 'number' : 'text'}
            minW="100px"
            bg="bg.canvas"
            borderColor="border.muted"
            fontFamily={parameter.type === 'number' ? 'mono' : 'inherit'}
            fontSize="sm"
            px={3}
            h={ROW_H}
            _focus={{
              borderColor: 'accent.teal',
              boxShadow: '0 0 0 1px var(--chakra-colors-accent-teal)',
            }}
            placeholder={parameter.type === 'number' ? '0' : 'value'}
          />
        )}

        {/* Clear button: visible when value is non-empty */}
        {hasValue && (
          <Tooltip content="Clear value">
            <IconButton
              aria-label="Clear value"
              variant="ghost"
              onClick={() => onChange('')}
              color="fg.subtle"
              h={ROW_H}
              w={ROW_H}
              minW={ROW_H}
              _hover={{ color: 'accent.danger', bg: 'bg.emphasized' }}
            >
              <LuX style={{ width: 10, height: 10 }} />
            </IconButton>
          </Tooltip>
        )}

        {/* Type selector - dropdown or read-only indicator */}
        {disableTypeChange ? (
          <HStack
            gap={1}
            px={2}
            h={ROW_H}
            bg="bg.canvas"
            borderRadius="sm"
            border="1px solid"
            borderColor="border.muted"
            fontSize="xs"
            fontWeight="600"
            style={{ color: getTypeColorHex(parameter.type) }}
            align="center"
          >
            {React.createElement(getTypeIcon(parameter.type), { size: 16 })}
          </HStack>
        ) : (
          <Tooltip content="Change parameter type">
            <MenuRoot positioning={{ placement: 'bottom' }}>
              <MenuTrigger asChild>
                <HStack
                  as="button"
                  gap={1}
                  px={2}
                  h={ROW_H}
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
                  align="center"
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
          </Tooltip>
        )}
      </HStack>
    </Box>
  );
}
