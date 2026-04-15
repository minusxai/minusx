'use client';

import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Box, HStack, Text, Input, Flex, Badge } from '@chakra-ui/react';
import { LuX, LuChevronDown, LuMail, LuMessageCircle, LuHash } from 'react-icons/lu';
import { AlertRecipient, User } from '@/lib/types';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { hasDeliveryEnabled, buildDropdownOptions, type DropdownOption } from '@/lib/messaging/delivery-options';
import { useUsers } from '@/lib/hooks/useUsers';

interface DeliveryPickerProps {
  recipients: AlertRecipient[];
  onChange: (recipients: AlertRecipient[]) => void;
  disabled?: boolean;
}

function recipientKey(r: AlertRecipient): string {
  return 'userId' in r ? `user:${r.userId}:${r.channel}` : `channel:${r.channelName}:${r.channel}`;
}

function optionToRecipient(opt: DropdownOption): AlertRecipient {
  if (opt.via === 'user') {
    return { userId: opt.user.id!, channel: opt.kind };
  }
  return { channelName: opt.channel.name, channel: opt.kind };
}

function DropdownMenu({ containerRef, options, onSelect }: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  options: DropdownOption[];
  onSelect: (recipient: AlertRecipient) => void;
}) {
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  const updatePos = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const DROPDOWN_MAX_H = 220;
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const top = spaceBelow >= DROPDOWN_MAX_H
      ? rect.bottom + 4
      : Math.max(8, rect.top - DROPDOWN_MAX_H - 4);
    setPos({ top, left: rect.left, width: rect.width });
  }, [containerRef]);

  useEffect(() => {
    updatePos();
    window.addEventListener('scroll', updatePos, true);
    window.addEventListener('resize', updatePos);
    return () => {
      window.removeEventListener('scroll', updatePos, true);
      window.removeEventListener('resize', updatePos);
    };
  }, [updatePos]);

  return (
    <Box
      position="fixed"
      top={`${pos.top}px`}
      left={`${pos.left}px`}
      width={`${pos.width}px`}
      bg="bg.surface"
      border="1px solid"
      borderColor="border.muted"
      borderRadius="md"
      boxShadow="md"
      zIndex={9999}
      maxH="220px"
      overflowY="auto"
    >
      {options.map((opt, i) => {
        const displayName = opt.via === 'user' ? opt.user.name : opt.channel.name;
        const subLabel =
          opt.via === 'user'
            ? (opt.kind === 'email' ? opt.user.email : opt.user.phone!)
            : opt.kind === 'slack' ? undefined : opt.channel.address;

        return (
          <HStack
            key={i}
            px={3}
            py={2}
            gap={2}
            cursor="pointer"
            _hover={{ bg: 'bg.muted' }}
            onMouseDown={(e: React.MouseEvent) => {
              e.preventDefault();
              onSelect(optionToRecipient(opt));
            }}
          >
            {opt.kind === 'email' ? <LuMail size={12} /> : opt.kind === 'phone' ? <LuMessageCircle size={12} /> : <LuHash size={12} />}
            <Box>
              <Text fontSize="xs" fontWeight="500">{displayName}</Text>
              {subLabel && <Text fontSize="xs" color="fg.muted">{subLabel}</Text>}
            </Box>
            <Badge size="xs" color={opt.kind === 'email' ? 'accent.danger' : opt.kind === 'phone' ? 'accent.primary' : 'accent.warning'} ml="auto">
              {opt.kind}
            </Badge>
          </HStack>
        );
      })}
    </Box>
  );
}

export function DeliveryPicker({ recipients, onChange, disabled }: DeliveryPickerProps) {
  const [inputValue, setInputValue] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { users } = useUsers();
  const { config } = useConfigs();

  const enabled = useMemo(() => hasDeliveryEnabled(config, users), [config, users]);
  const effectiveDisabled = disabled || !enabled;

  // Map userId → user for label display
  const userById = useMemo(() => {
    const map = new Map<number, User>();
    for (const user of users) {
      if (user.id != null) map.set(user.id, user);
    }
    return map;
  }, [users]);

  const dropdownOptions = useMemo(
    () => buildDropdownOptions(config, users, recipients, inputValue),
    [config, users, recipients, inputValue],
  );

  const addRecipient = (recipient: AlertRecipient) => {
    const key = recipientKey(recipient);
    if (recipients.some(r => recipientKey(r) === key)) return;
    onChange([...recipients, recipient]);
    setInputValue('');
    setShowDropdown(false);
  };

  const removeRecipient = (index: number) => {
    onChange(recipients.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !inputValue && recipients.length > 0) {
      removeRecipient(recipients.length - 1);
    }
    if (e.key === 'Escape') setShowDropdown(false);
  };

  const handleBlur = () => {
    setTimeout(() => setShowDropdown(false), 150);
  };

  function recipientLabel(r: AlertRecipient): string {
    if ('userId' in r) {
      return userById.get(r.userId)?.name ?? `User #${r.userId}`;
    }
    return r.channelName;
  }

  function recipientChannel(r: AlertRecipient): 'email' | 'phone' | 'slack' {
    return r.channel;
  }

  return (
    <Box position="relative" ref={containerRef}>
      <Flex
        flexWrap="wrap"
        gap={1.5}
        p={1.5}
        minH="36px"
        bg="bg.surface"
        borderRadius="md"
        border="1px solid"
        borderColor="border.muted"
        alignItems="center"
        cursor={effectiveDisabled ? 'not-allowed' : 'text'}
        opacity={effectiveDisabled ? 0.6 : 1}
        onClick={() => { if (!effectiveDisabled) inputRef.current?.focus(); }}
      >
        {recipients.map((r, i) => (
          <HStack key={i} bg="bg.muted" borderRadius="sm" px={2} py={0.5} gap={1} fontSize="xs">
            <Text fontSize="xs" lineHeight="short">
              {recipientLabel(r)}
            </Text>
            <Badge size="xs" color={recipientChannel(r) === 'email' ? 'accent.danger' : recipientChannel(r) === 'phone' ? 'accent.primary' : 'accent.warning'}>
              {recipientChannel(r)}
            </Badge>
            {!effectiveDisabled && (
              <button
                onClick={(e) => { e.stopPropagation(); removeRecipient(i); }}
                style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', background: 'none', border: 'none', padding: 0, color: 'inherit' }}
              >
                <LuX size={12} />
              </button>
            )}
          </HStack>
        ))}
        {!effectiveDisabled && (
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => { setInputValue(e.target.value); setShowDropdown(true); }}
            onFocus={() => setShowDropdown(true)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            autoComplete="one-time-code"
            placeholder={recipients.length === 0 ? 'Search users or channels...' : ''}
            size="xs"
            variant="outline"
            border="none"
            _focus={{ boxShadow: 'none' }}
            flex="1"
            minW="120px"
            fontSize="xs"
          />
        )}
        {effectiveDisabled && !enabled && (
          <Text fontSize="xs" color="fg.muted" px={1}>No delivery channels configured</Text>
        )}
        {!effectiveDisabled && dropdownOptions.length > 0 && (
          <button
            onClick={() => { setShowDropdown(!showDropdown); inputRef.current?.focus(); }}
            style={{ display: 'flex', alignItems: 'center', flexShrink: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit' }}
          >
            <LuChevronDown size={14} />
          </button>
        )}
      </Flex>

      {showDropdown && !effectiveDisabled && dropdownOptions.length > 0 && createPortal(
        <DropdownMenu containerRef={containerRef} options={dropdownOptions} onSelect={addRecipient} />,
        document.body
      )}
    </Box>
  );
}

export function DeliveryCard({ recipients, onChange, disabled }: DeliveryPickerProps) {
  return (
    <Box position="relative" bg="bg.muted" borderRadius="md" border="1px solid" borderColor="border.muted" p={3} pl={5} overflow="hidden">
      <Box position="absolute" left={0} top={0} bottom={0} width="3px" bg="accent.primary" borderLeftRadius="md" />
      <HStack mb={2} gap={1.5}>
        <LuMail size={14} color="var(--chakra-colors-accent-primary)" />
        <Text fontWeight="700" fontSize="xs" textTransform="uppercase" letterSpacing="wider" color="fg.muted">Delivery</Text>
      </HStack>
      <DeliveryPicker recipients={recipients} onChange={onChange} disabled={disabled} />
    </Box>
  );
}
