'use client';

import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Box, HStack, Text, Input, Flex, Badge } from '@chakra-ui/react';
import { LuX, LuChevronDown, LuMail, LuMessageCircle, LuHash } from 'react-icons/lu';
import { useFetch } from '@/lib/api/useFetch';
import { API } from '@/lib/api/declarations';
import { AlertRecipient, User } from '@/lib/types';
import { useConfigs } from '@/lib/hooks/useConfigs';
import { hasDeliveryEnabled, buildDropdownOptions, type DropdownOption } from '@/lib/messaging/delivery-options';

interface DeliveryPickerProps {
  recipients: AlertRecipient[];
  onChange: (recipients: AlertRecipient[]) => void;
  disabled?: boolean;
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
        const address =
          opt.via === 'user'
            ? (opt.kind === 'email_alert' ? opt.user.email : opt.user.phone!)
            : opt.kind === 'slack_alert' ? opt.channel.name : opt.channel.address;
        const displayName =
          opt.via === 'user' ? opt.user.name : opt.channel.name;
        const subLabel =
          opt.via === 'user' ? address :
          opt.kind === 'slack_alert' ? undefined : opt.channel.address;

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
              onSelect({ channel: opt.kind, address });
            }}
          >
            {opt.kind === 'email_alert' ? <LuMail size={12} /> : opt.kind === 'phone_alert' ? <LuMessageCircle size={12} /> : <LuHash size={12} />}
            <Box>
              <Text fontSize="xs" fontWeight="500">{displayName}</Text>
              {subLabel && <Text fontSize="xs" color="fg.muted">{subLabel}</Text>}
            </Box>
            <Badge size="xs" color={opt.kind === 'email_alert' ? 'accent.danger' : opt.kind === 'phone_alert' ? 'accent.primary' : 'accent.warning'} ml="auto">
              {opt.kind === 'email_alert' ? 'email' : opt.kind === 'phone_alert' ? 'phone' : 'slack'}
            </Badge>
          </HStack>
        );
      })}
    </Box>
  );
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function DeliveryPicker({ recipients, onChange, disabled }: DeliveryPickerProps) {
  const [inputValue, setInputValue] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: usersResponse } = useFetch<void, { success: boolean; data: { users: User[] } }>(API.users.list);
  const users = usersResponse?.data?.users ?? [];

  const { config } = useConfigs();

  const enabled = useMemo(() => hasDeliveryEnabled(config, users), [config, users]);
  const effectiveDisabled = disabled || !enabled;

  const userNameByAddress = useMemo(() => {
    const map = new Map<string, string>();
    for (const user of users) {
      map.set(user.email, user.name);
      if (user.phone) map.set(user.phone, user.name);
    }
    return map;
  }, [users]);

  const channelNameByAddress = useMemo(() => {
    const map = new Map<string, string>();
    for (const ch of config.channels ?? []) {
      if (ch.type === 'email' || ch.type === 'phone') map.set(ch.address, ch.name);
    }
    return map;
  }, [config.channels]);

  const dropdownOptions = useMemo(
    () => buildDropdownOptions(config, users, recipients, inputValue),
    [config, users, recipients, inputValue],
  );

  const addRecipient = (recipient: AlertRecipient) => {
    const key = `${recipient.channel}:${recipient.address}`;
    if (recipients.some(r => `${r.channel}:${r.address}` === key)) return;
    onChange([...recipients, recipient]);
    setInputValue('');
    setShowDropdown(false);
  };

  const addEmailFromInput = (email: string, { validate = false } = {}) => {
    if (!config.messaging?.webhooks?.some(w => w.type === 'email_alert')) return;
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    if (validate && !EMAIL_REGEX.test(trimmed)) return;
    addRecipient({ channel: 'email_alert', address: trimmed });
  };

  const removeRecipient = (index: number) => {
    onChange(recipients.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (inputValue.trim()) addEmailFromInput(inputValue, { validate: true });
    }
    if (e.key === 'Backspace' && !inputValue && recipients.length > 0) {
      removeRecipient(recipients.length - 1);
    }
    if (e.key === 'Escape') setShowDropdown(false);
  };

  const handleBlur = () => {
    setTimeout(() => {
      if (inputValue.trim()) addEmailFromInput(inputValue, { validate: true });
      setShowDropdown(false);
    }, 150);
  };

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
              {r.channel === 'slack_alert'
                ? r.address
                : (channelNameByAddress.get(r.address) ?? userNameByAddress.get(r.address) ?? r.address)}
            </Text>
            <Badge size="xs" color={r.channel === 'email_alert' ? 'accent.danger' : r.channel === 'phone_alert' ? 'accent.primary' : 'accent.warning'}>
              {r.channel === 'email_alert' ? 'email' : r.channel === 'phone_alert' ? 'phone' : 'slack'}
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
            placeholder={recipients.length === 0 ? 'Add email or select user...' : ''}
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
