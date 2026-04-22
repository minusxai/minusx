'use client';

import { Box } from '@chakra-ui/react';
import { useRouter } from '@/lib/navigation/use-navigation';
import { preserveModeParam } from '@/lib/mode/mode-utils';
import ConnectionWizard from '@/components/connection-wizard/ConnectionWizard';

export default function NewConnectionPage() {
  const router = useRouter();

  return (
    <Box minH="100vh" bg="bg.canvas" px={4} pt={10}>
      <Box maxW="1060px" mx="auto">
        <ConnectionWizard
          onComplete={async () => {
            router.push(preserveModeParam('/'));
          }}
        />
      </Box>
    </Box>
  );
}
