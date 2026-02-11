'use client';

import { Box, HStack, VStack, Text } from '@chakra-ui/react';

interface ColorPickerProps {
  label: string;
  value: string;
  onChange: (color: string) => void;
}

// Flat UI Colors from theme
const PRESET_COLORS = [
  'transparent',  // Transparent
  '#ffffff',      // White
  '#000000',      // Black
  '#2980b9',      // Belize Hole (primary blue)
  '#9b59b6',      // Amethyst (purple)
  '#16a085',      // Green Sea (teal)
  '#f39c12',      // Orange
  '#c0392b',      // Pomegranate (red)
  '#34495e',      // Wet Asphalt (dark gray)
  '#95a5a6',      // Concrete (light gray)
  '#f1c40f',      // Sun Flower (yellow)
];

export default function ColorPicker({ label, value, onChange }: ColorPickerProps) {
  return (
    <VStack align="stretch" gap={2}>
      <Text fontSize="sm" fontWeight="600">
        {label}
      </Text>
      <HStack gap={1.5} flexWrap="wrap">
        {PRESET_COLORS.map((color) => (
          <Box
            key={color}
            width="18px"
            height="18px"
            bg={color === 'transparent' ? undefined : color}
            borderRadius="sm"
            border="2px solid"
            borderColor={value === color ? 'accent.secondary' : 'border.default'}
            cursor="pointer"
            onClick={() => onChange(color)}
            _hover={{
              transform: 'scale(1.15)',
              borderColor: 'accent.secondary',
            }}
            transition="all 0.2s"
            boxShadow={value === color ? '0 0 0 2px rgba(155, 89, 182, 0.3)' : 'none'}
            position="relative"
            overflow="hidden"
            style={
              color === 'transparent'
                ? {
                    backgroundImage:
                      'linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%)',
                    backgroundSize: '6px 6px',
                    backgroundPosition: '0 0, 0 3px, 3px -3px, -3px 0px',
                  }
                : undefined
            }
          />
        ))}
      </HStack>
      <HStack gap={2}>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: '100%',
            height: '25px',
            // border: '1px solid #ccc',
            borderRadius: '30px',
            cursor: 'pointer',
          }}
        />
      </HStack>
    </VStack>
  );
}
