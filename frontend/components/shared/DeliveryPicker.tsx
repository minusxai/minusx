'use client';

import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Box, HStack, Text, Input, Flex, Badge } from '@chakra-ui/react';
import { LuX, LuChevronDown, LuMail, LuMessageCircle, LuHash } from 'react-icons/lu';
import { useFetch } from '@/lib/api/useFetch';
import { API } from '@/lib/api/declarations';
import { AlertRecipient, ConfigChannel, User } from '@/lib/types';
import { useConfigs } from '@/lib/hooks/useConfigs';

interface DeliveryPickerProps {
  recipients: AlertRecipient[];
  onChange: (recipients: AlertRecipient[]) => void;
  disabled?: boolean;
}

type SlackChannel  = Extract<ConfigChannel, { type: 'slack' }>;
type EmailChannel  = Extract<ConfigChannel, { type: 'email' }>;
type PhoneChannel  = Extract<ConfigChannel, { type: 'phone' }>;

type DropdownOption =
  | { kind: 'email_alert'; via: 'user';    user: User }
  | { kind: 'phone_alert'; via: 'user';    user: User }
  | { kind: 'slack_alert'; via: 'channel'; channel: SlackChannel }
  | { kind: 'email_alert'; via: 'channel'; channel: EmailChannel }
  | { kind: 'phone_alert'; via: 'channel'; channel: PhoneChannel };

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
      {options.map((opt, i) => {
        const address =
          opt.via === 'user'
            ? (opt.kind === 'email_alert' ? opt.user.email : opt.user.phone!)
            : opt.kind === 'slack_alert' ? opt.channel.name : opt.channel.address;
        const displayName =
          opt.via === 'user' ? opt.user.name :
          opt.kind === 'slack_alert' ? opt.channel.name : opt.channel.name;
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
  const configuredWebhookTypes = useMemo(
    () => new Set(config.messaging?.webhooks?.map(w => w.type) ?? []),
    [config.messaging?.webhooks]
  );
  const slackChannels = useMemo(
    () => (config.channels ?? []).filter((c): c is SlackChannel => c.type === 'slack'),
    [config.channels]
  );
  const emailChannels = useMemo(
    () => (config.channels ?? []).filter((c): c is EmailChannel => c.type === 'email'),
    [config.channels]
  );
  const phoneChannels = useMemo(
    () => (config.channels ?? []).filter((c): c is PhoneChannel => c.type === 'phone'),
    [config.channels]
  );

  const hasAnyChannel =
    configuredWebhookTypes.has('email_alert') || configuredWebhookTypes.has('phone_alert') ||
    (configuredWebhookTypes.has('slack_alert') && slackChannels.length > 0) ||
    emailChannels.length > 0 || phoneChannels.length > 0;
  const effectiveDisabled = disabled || !hasAnyChannel;

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

  const recipientKeys = useMemo(
    () => new Set(recipients.map(r => `${r.channel}:${r.address}`)),
    [recipients]
  );

  const dropdownOptions = useMemo<DropdownOption[]>(() => {
    const query = inputValue.toLowerCase();
    const opts: DropdownOption[] = [];

    // User-based email/phone options
    for (const user of users) {
      const matches = !query || user.name.toLowerCase().includes(query) || user.email.toLowerCase().includes(query);
      if (!matches) continue;
      if (configuredWebhookTypes.has('email_alert') && !recipientKeys.has(`email_alert:${user.email}`)) {
        opts.push({ kind: 'email_alert', via: 'user', user });
      }
      if (configuredWebhookTypes.has('phone_alert') && user.phone && !recipientKeys.has(`phone_alert:${user.phone}`)) {
        opts.push({ kind: 'phone_alert', via: 'user', user });
      }
    }

    // Config channel options
    for (const ch of emailChannels) {
      if (!recipientKeys.has(`email_alert:${ch.address}`)) {
        opts.push({ kind: 'email_alert', via: 'channel', channel: ch });
      }
    }
    for (const ch of phoneChannels) {
      if (!recipientKeys.has(`phone_alert:${ch.address}`)) {
        opts.push({ kind: 'phone_alert', via: 'channel', channel: ch });
      }
    }
    if (configuredWebhookTypes.has('slack_alert')) {
      for (const ch of slackChannels) {
        if (!recipients.some(r => r.channel === 'slack_alert' && r.address === ch.name)) {
          opts.push({ kind: 'slack_alert', via: 'channel', channel: ch });
        }
      }
    }

    return opts;
  }, [users, inputValue, recipientKeys, configuredWebhookTypes, emailChannels, phoneChannels, slackChannels, recipients]);

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
        {effectiveDisabled && !hasAnyChannel && (
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
