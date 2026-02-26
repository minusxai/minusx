'use client';

import { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Box, HStack, Text, Input, Flex } from '@chakra-ui/react';
import { LuX, LuChevronDown } from 'react-icons/lu';
import { useFetch } from '@/lib/api/useFetch';
import { API } from '@/lib/api/declarations';
import { User } from '@/lib/types';

interface DeliveryPickerProps {
  emails: string[];
  onChange: (emails: string[]) => void;
  disabled?: boolean;
}

function DropdownMenu({ containerRef, filteredUsers, addEmail }: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  filteredUsers: User[];
  addEmail: (email: string) => void;
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
      maxH="200px"
      overflowY="auto"
    >
      {filteredUsers.map((user) => (
        <Box
          key={user.email}
          px={3}
          py={2}
          cursor="pointer"
          _hover={{ bg: 'bg.muted' }}
          onMouseDown={(e: React.MouseEvent) => {
            e.preventDefault();
            addEmail(user.email);
          }}
        >
          <Text fontSize="xs" fontWeight="500">{user.name}</Text>
          <Text fontSize="xs" color="fg.muted">{user.email}</Text>
        </Box>
      ))}
    </Box>
  );
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function DeliveryPicker({ emails, onChange, disabled }: DeliveryPickerProps) {
  const [inputValue, setInputValue] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: usersResponse } = useFetch<void, { success: boolean; data: { users: User[] } }>(API.users.list);
  const users = usersResponse?.data?.users ?? [];

  const filteredUsers = useMemo(() => {
    if (users.length === 0) return [];
    const query = inputValue.toLowerCase();
    return users.filter(u =>
      !emails.includes(u.email) &&
      (u.name.toLowerCase().includes(query) || u.email.toLowerCase().includes(query))
    );
  }, [users, inputValue, emails]);

  const addEmail = (email: string, { validate = false } = {}) => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || emails.includes(trimmed)) {
      setInputValue('');
      return;
    }
    if (validate && !EMAIL_REGEX.test(trimmed)) {
      return; // keep input so user can fix it
    }
    onChange([...emails, trimmed]);
    setInputValue('');
    setShowDropdown(false);
  };

  const removeEmail = (email: string) => {
    onChange(emails.filter(e => e !== email));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (inputValue.trim()) {
        addEmail(inputValue, { validate: true });
      }
    }
    if (e.key === 'Backspace' && !inputValue && emails.length > 0) {
      removeEmail(emails[emails.length - 1]);
    }
    if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };

  const handleBlur = () => {
    // Delay to allow click on dropdown items
    setTimeout(() => {
      if (inputValue.trim()) {
        addEmail(inputValue, { validate: true });
      }
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
        cursor={disabled ? 'not-allowed' : 'text'}
        opacity={disabled ? 0.6 : 1}
        onClick={() => {
          if (!disabled) inputRef.current?.focus();
        }}
      >
        {emails.map((email) => (
          <HStack
            key={email}
            bg="bg.muted"
            borderRadius="sm"
            px={2}
            py={0.5}
            gap={1}
            fontSize="xs"
          >
            <Text fontSize="xs" lineHeight="short">{email}</Text>
            {!disabled && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeEmail(email);
                }}
                style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', background: 'none', border: 'none', padding: 0, color: 'inherit' }}
              >
                <LuX size={12} />
              </button>
            )}
          </HStack>
        ))}
        {!disabled && (
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              setShowDropdown(true);
            }}
            onFocus={() => setShowDropdown(true)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            placeholder={emails.length === 0 ? 'Add email or select user...' : ''}
            size="xs"
            variant="outline"
            border="none"
            _focus={{ boxShadow: 'none' }}
            flex="1"
            minW="120px"
            fontSize="xs"
          />
        )}
        {!disabled && users.length > 0 && (
          <button
            onClick={() => {
              setShowDropdown(!showDropdown);
              inputRef.current?.focus();
            }}
            style={{ display: 'flex', alignItems: 'center', flexShrink: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit' }}
          >
            <LuChevronDown size={14} />
          </button>
        )}
      </Flex>

      {showDropdown && !disabled && filteredUsers.length > 0 && createPortal(
        <DropdownMenu containerRef={containerRef} filteredUsers={filteredUsers} addEmail={addEmail} />,
        document.body
      )}
    </Box>
  );
}
