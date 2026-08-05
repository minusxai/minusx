'use client';

import { Box } from '@chakra-ui/react';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/lib/navigation/use-navigation';
import { preserveModeParam } from '@/lib/mode/mode-utils';
import ConnectionWizard from '@/components/connection-wizard/ConnectionWizard';
import { staticTabForConnectionType } from '@/components/connection-wizard/ConnectionWizardTypes';

export default function NewConnectionPage() {
  const router = useRouter();
  // ?type=csv|xlsx|google-sheets opens straight on that upload tab. install.sh
  // sends people here when they pick a file-based source it cannot finish itself.
  const staticTab = staticTabForConnectionType(useSearchParams().get('type'));

  return (
    <Box minH="100vh" bg="bg.canvas" px={4} pt={10}>
      <Box maxW="1060px" mx="auto">
        <ConnectionWizard
          initialStaticTab={staticTab}
          onComplete={async () => {
            router.push(preserveModeParam('/'));
          }}
        />
      </Box>
    </Box>
  );
}
