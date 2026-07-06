'use client';

import { HStack, Icon, Text, VStack } from '@chakra-ui/react';
import { LuLayoutDashboard } from 'react-icons/lu';
import { Tooltip } from '@/components/ui/tooltip';

interface DashboardInfo {
  id: number;
  name: string;
}

interface DashboardUsageBadgeProps {
  dashboards?: DashboardInfo[];
  compact?: boolean;
}

export default function DashboardUsageBadge({ dashboards, compact = false }: DashboardUsageBadgeProps) {
  if (!dashboards || dashboards.length === 0) {
    return null;
  }

  const badgeContent = (
    <HStack
      gap={1.5}
      px={2}
      py={0.5}
      bg="accent.danger/10"
      borderRadius="full"
      fontSize={compact ? '2xs' : 'xs'}
      color="accent.danger/80"
      flexShrink={0}
      fontWeight="500"
      cursor="default"
      _hover={{ bg: 'accent.danger/15' }}
      transition="background 0.15s"
    >
      <Icon as={LuLayoutDashboard} boxSize={compact ? 2.5 : 3} />
      {dashboards.length === 1 ? (
        <Text truncate maxW={compact ? '60px' : '120px'}>
          {dashboards[0].name}
        </Text>
      ) : (
        <Text>{dashboards.length} dashboards</Text>
      )}
    </HStack>
  );

  const tooltipContent = (
    <VStack align="start" gap={1}>
      <Text fontWeight="600" fontSize="xs" color="fg.muted">
        Used in {dashboards.length === 1 ? '1 dashboard' : `${dashboards.length} dashboards`}
      </Text>
      {dashboards.map((d) => (
        <HStack key={d.id} gap={1.5}>
          <Icon as={LuLayoutDashboard} boxSize={3} color="accent.danger" />
          <Text fontSize="xs">{d.name}</Text>
        </HStack>
      ))}
    </VStack>
  );

  return (
    <Tooltip content={tooltipContent} positioning={{ placement: 'top' }}>
      {badgeContent}
    </Tooltip>
  );
}
