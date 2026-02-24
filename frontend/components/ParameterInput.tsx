'use client';

import React from 'react';
import { Input, HStack, Text, MenuRoot, MenuTrigger, MenuContent, MenuItem, Portal, MenuPositioner, Box, IconButton } from '@chakra-ui/react';
import { LuChevronDown, LuX, LuPin, LuRotateCcw } from 'react-icons/lu';
import { Tooltip } from '@/components/ui/tooltip';
import { QuestionParameter } from '@/lib/types';
import { getTypeColor, getTypeColorHex, getTypeIcon } from '@/lib/sql/sql-params';
import DatePicker from './DatePicker';

const ROW_H = '32px';

interface ParameterInputProps {
  parameter: QuestionParameter;
  value: string | number | undefined;
  defaultValue?: string | number | null;
  onChange: (value: string | number) => void;
  onTypeChange: (type: 'text' | 'number' | 'date') => void;
  onSubmit?: (paramName?: string, value?: string | number) => void;
  onSetDefault?: (value: string | number | undefined) => void;
  disableTypeChange?: boolean;
  disableSetDefault?: boolean;
  onHoverParam?: (key: string | null) => void;
}

export default function ParameterInput({
  parameter,
  value,
  defaultValue,
  onChange,
  onTypeChange,
  onSubmit,
  onSetDefault,
  disableTypeChange = false,
  disableSetDefault = false,
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
  const hasDefault = defaultValue !== undefined && defaultValue !== null && defaultValue !== '';
  const isDifferentFromDefault = hasDefault && String(value) !== String(defaultValue);

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

      {/* Default value badge - floating label (top right) */}
      {hasDefault && (
        <Tooltip content={`Default: ${String(defaultValue)}`}>
          <Text
            position="absolute"
            top={-2}
            right={2}
            fontSize="2xs"
            fontWeight="500"
            color="fg.subtle"
            fontFamily="mono"
            bg="bg.muted"
            border="1px solid"
            borderColor="border.emphasized"
            borderRadius={4}
            px={1.5}
            maxW="120px"
            overflow="hidden"
            textOverflow="ellipsis"
            whiteSpace="nowrap"
          >
            default: {String(defaultValue)}
          </Text>
        </Tooltip>
      )}

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
            maxW="150px"
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
            placeholder={hasDefault ? String(defaultValue) : (parameter.type === 'number' ? '0' : 'value')}
          />
        )}

        {/* Reset to default: icon-only, visible when value differs from default */}
        {isDifferentFromDefault && (
          <Tooltip content={`Reset to default (${String(defaultValue)})`}>
            <IconButton
              aria-label="Reset to default"
              variant="outline"
              onClick={() => onChange(defaultValue as string | number)}
              color="fg.subtle"
              h={ROW_H}
              w={ROW_H}
              minW={ROW_H}
              bg="bg.canvas"
              borderColor="border.muted"
              _hover={{ color: 'accent.teal', borderColor: 'accent.teal', bg: 'bg.surface' }}
            >
              <LuRotateCcw style={{ width: 10, height: 10 }} />
            </IconButton>
          </Tooltip>
        )}

        {/* Pin as default: visible when value exists and not in dashboard view */}
        {hasValue && !disableSetDefault && onSetDefault && (
          <Tooltip content="Set as default value">
            <IconButton
              aria-label="Set as default value"
              variant="outline"
              onClick={() => onSetDefault(value)}
              color="fg.subtle"
              h={ROW_H}
              w={ROW_H}
              minW={ROW_H}
              bg="bg.canvas"
              borderColor="border.muted"
              _hover={{ color: 'accent.teal', borderColor: 'accent.teal', bg: 'bg.surface' }}
            >
              <LuPin style={{ width: 10, height: 10 }} />
            </IconButton>
          </Tooltip>
        )}

        {/* Clear button: visible when no default exists and value is non-empty */}
        {hasValue && !hasDefault && (
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
