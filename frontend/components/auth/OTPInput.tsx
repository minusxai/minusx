/**
 * OTP Input Component
 * 6-digit input with auto-focus between fields
 */

'use client';

import { useRef, KeyboardEvent, ClipboardEvent } from 'react';
import { HStack, Input } from '@chakra-ui/react';

interface OTPInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
}

export function OTPInput({
  length = 6,
  value,
  onChange,
  onComplete,
  disabled = false
}: OTPInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Split value into individual digits (create array of specified length)
  const digits = Array.from({ length }, (_, i) => value[i] || '');

  const handleChange = (index: number, digit: string) => {
    // Only allow numbers
    if (digit && !/^\d$/.test(digit)) {
      return;
    }

    // Update the value
    const newDigits = [...digits];
    newDigits[index] = digit;
    const newValue = newDigits.join('').trim();
    onChange(newValue);

    // Auto-focus next input
    if (digit && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }

    // Call onComplete if all digits filled
    if (digit && newValue.length === length && onComplete) {
      onComplete(newValue);
    }
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    // Backspace: clear current and focus previous
    if (e.key === 'Backspace') {
      if (!digits[index] && index > 0) {
        // Current empty, focus previous
        inputRefs.current[index - 1]?.focus();
      } else {
        // Clear current
        const newDigits = [...digits];
        newDigits[index] = '';
        onChange(newDigits.join('').trim());
      }
    }

    // Arrow keys for navigation
    if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
    if (e.key === 'ArrowRight' && index < length - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text/plain');
    const digits = pastedData.replace(/\D/g, '').slice(0, length);

    if (digits) {
      onChange(digits);
      // Focus last filled input
      const focusIndex = Math.min(digits.length, length - 1);
      inputRefs.current[focusIndex]?.focus();

      // Call onComplete if all digits filled
      if (digits.length === length && onComplete) {
        onComplete(digits);
      }
    }
  };

  return (
    <HStack gap={2} justify="center" w="full">
      {digits.map((digit, index) => (
        <Input
          key={index}
          ref={(el) => { inputRefs.current[index] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digit}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          disabled={disabled}
          textAlign="center"
          fontSize="2xl"
          fontWeight="bold"
          width="50px"
          minWidth="50px"
          height="60px"
          minHeight="60px"
          border="2px solid"
          borderColor="border.emphasized"
          borderRadius="md"
          bg="bg.panel"
          color="fg.default"
          px={2}
          py={3}
          _focus={{
            borderColor: 'accent.teal',
            borderWidth: '2px',
            outline: 'none',
          }}
          _hover={{
            borderColor: 'border.emphasized',
          }}
        />
      ))}
    </HStack>
  );
}
