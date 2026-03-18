'use client';

import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Box, HStack, Text, Input, Flex, Badge } from '@chakra-ui/react';
import { LuX, LuChevronDown, LuMail, LuMessageCircle } from 'react-icons/lu';
import { useFetch } from '@/lib/api/useFetch';
import { API } from '@/lib/api/declarations';
import { AlertRecipient, User } from '@/lib/types';
import { useConfigs } from '@/lib/hooks/useConfigs';

interface DeliveryPickerProps {
  recipients: AlertRecipient[];
  onChange: (recipients: AlertRecipient[]) => void;
  disabled?: boolean;
}

type DropdownOption =
  | { kind: 'email_alert'; user: User }
  | { kind: 'phone_alert'; user: User };

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
    setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
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
      {options.map((opt, i) => (
        <HStack
          key={i}
          px={3}
          py={2}
          gap={2}
          cursor="pointer"
          _hover={{ bg: 'bg.muted' }}
          onMouseDown={(e: React.MouseEvent) => {
            e.preventDefault();
            onSelect(
              opt.kind === 'email_alert'
                ? { channel: 'email_alert', address: opt.user.email }
                : { channel: 'phone_alert', address: opt.user.phone! }
            );
          }}
        >
          {opt.kind === 'email_alert'
            ? <LuMail size={12} />
            : <LuMessageCircle size={12} />}
          <Box>
            <Text fontSize="xs" fontWeight="500">{opt.user.name}</Text>
            <Text fontSize="xs" color="fg.muted">
              {opt.kind === 'email_alert' ? opt.user.email : opt.user.phone}
            </Text>
          </Box>
          <Badge size="xs" color={opt.kind === 'email_alert' ? 'accent.danger' : 'accent.primary'} ml="auto">
            {opt.kind === 'email_alert' ? 'email' : 'phone'}
          </Badge>
        </HStack>
      ))}
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
  const configuredWebhookTypes = useMemo(
    () => new Set(config.messaging?.webhooks?.map(w => w.type) ?? []),
    [config.messaging?.webhooks]
  );
  const hasAnyChannel = configuredWebhookTypes.has('email_alert') || configuredWebhookTypes.has('phone_alert');
  const effectiveDisabled = disabled || !hasAnyChannel;

  const userNameByAddress = useMemo(() => {
    const map = new Map<string, string>();
    for (const user of users) {
      map.set(user.email, user.name);
      if (user.phone) map.set(user.phone, user.name);
    }
    return map;
  }, [users]);

  const recipientKeys = useMemo(
    () => new Set(recipients.map(r => `${r.channel}:${r.address}`)),
    [recipients]
  );

  const dropdownOptions = useMemo<DropdownOption[]>(() => {
    const query = inputValue.toLowerCase();
    const opts: DropdownOption[] = [];
    for (const user of users) {
      const matches = !query || user.name.toLowerCase().includes(query) || user.email.toLowerCase().includes(query);
      if (!matches) continue;
      if (configuredWebhookTypes.has('email_alert') && !recipientKeys.has(`email_alert:${user.email}`)) {
        opts.push({ kind: 'email_alert', user });
      }
      if (configuredWebhookTypes.has('phone_alert') && user.phone && !recipientKeys.has(`phone_alert:${user.phone}`)) {
        opts.push({ kind: 'phone_alert', user });
      }
    }
    return opts;
  }, [users, inputValue, recipientKeys, configuredWebhookTypes]);

  const addRecipient = (recipient: AlertRecipient) => {
    const key = `${recipient.channel}:${recipient.address}`;
    if (recipientKeys.has(key)) return;
    onChange([...recipients, recipient]);
    setInputValue('');
    setShowDropdown(false);
  };

  const addEmailFromInput = (email: string, { validate = false } = {}) => {
    if (!configuredWebhookTypes.has('email_alert')) return;
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
          <HStack
            key={i}
            bg="bg.muted"
            borderRadius="sm"
            px={2}
            py={0.5}
            gap={1}
            fontSize="xs"
          >
            <Text fontSize="xs" lineHeight="short">
              {userNameByAddress.get(r.address) ?? r.address}
            </Text>
            <Badge size="xs" color={r.channel === 'email_alert' ? 'accent.danger' : 'accent.primary'}>
              {r.channel === 'email_alert' ? 'email' : 'phone'}
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
        {effectiveDisabled && !hasAnyChannel && (
          <Text fontSize="xs" color="fg.muted" px={1}>No delivery channels configured</Text>
        )}
        {!effectiveDisabled && users.length > 0 && (
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
