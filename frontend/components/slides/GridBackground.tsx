'use client';

import { Box } from '@chakra-ui/react';

export default function GridBackground() {
  return (
    <Box
      position="absolute"
      top={0}
      left={0}
      width="100%"
      height="100%"
      pointerEvents="none"
      opacity={0.15}
      style={{
        backgroundImage: `
          linear-gradient(rgba(155, 89, 182, 0.08) 1px, transparent 1px),
          linear-gradient(90deg, rgba(155, 89, 182, 0.08) 1px, transparent 1px)
        `,
        backgroundSize: '32px 32px',
      }}
    />
  );
}
