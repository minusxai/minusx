'use client';

import { Box, VStack, HStack, Text, Heading, Button, Icon } from '@chakra-ui/react';
import { LuSparkles, LuRocket, LuLayoutDashboard, LuMessageSquare } from 'react-icons/lu';
import { useRouter } from '@/lib/navigation/use-navigation';
import { sparkleKeyframes } from '@/lib/ui/animations';

interface StepGeneratingProps {
  connectionName: string;
  contextFileId: number;
}

export default function StepGenerating({ connectionName, contextFileId }: StepGeneratingProps) {
  const router = useRouter();

  return (
    <VStack gap={8} py={12} align="center" justify="center" minH="400px">
      <style>{sparkleKeyframes}</style>

      <Box css={{ animation: 'sparkle 2s ease-in-out infinite' }}>
        <Icon as={LuRocket} boxSize={12} color="accent.teal" />
      </Box>

      <VStack gap={3} textAlign="center">
        <Heading size="lg" fontFamily="mono" fontWeight="400">
          You&apos;re all set!
        </Heading>
        <Text color="fg.muted" fontSize="sm" maxW="400px">
          Your data is connected and your knowledge base is ready.
          Start exploring by asking a question or creating a dashboard.
        </Text>
      </VStack>

      <HStack gap={4} pt={4}>
        <Button
          bg="accent.teal"
          color="white"
          _hover={{ opacity: 0.9 }}
          size="sm"
          fontFamily="mono"
          onClick={() => router.push('/explore')}
        >
          <LuMessageSquare size={14} />
          Ask a question
        </Button>
        <Button
          variant="outline"
          size="sm"
          fontFamily="mono"
          onClick={() => router.push('/new/dashboard')}
        >
          <LuLayoutDashboard size={14} />
          New dashboard
        </Button>
      </HStack>
    </VStack>
  );
}
