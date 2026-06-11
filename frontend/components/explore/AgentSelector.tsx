'use client';

import { memo } from 'react';
import { Box, Text, HStack, Icon, Menu } from '@chakra-ui/react';
import { LuChevronDown, LuCheck } from 'react-icons/lu';
import { shallowEqualExcept } from '@/lib/hooks/use-stable-callback';
import {
  DEMO_AGENTS,
  GENERAL_AGENT,
  getDemoAgent,
  getBusinessUnit,
  type AgentSelection,
} from './demo-agents';

interface AgentSelectorProps {
  value: AgentSelection;
  onChange: (selection: AgentSelection) => void;
}

// All selectable options: the default General agent + the demo personas.
const OPTIONS = [GENERAL_AGENT, ...DEMO_AGENTS];

function AgentSelectorInner({ value, onChange }: AgentSelectorProps) {
  const agent = getDemoAgent(value.agentId) ?? GENERAL_AGENT;
  const bu = getBusinessUnit(value.businessUnitId);

  const trigger = (
    <HStack
      gap={1.5}
      px={1.5}
      py={0.5}
      borderRadius="md"
      cursor="pointer"
      transition="background 0.15s ease"
      aria-label="Agent selector"
      _hover={{ bg: 'bg.muted' }}
      role="group"
    >
      <Icon as={agent.icon} boxSize={3.5} color={agent.color} flexShrink={0} />
      <Text fontSize="xs" color="fg.default" fontWeight="600" whiteSpace="nowrap">
        {agent.name}
        {bu && (
          <Text as="span" color="fg.muted" fontWeight="400">
            {' · '}{bu.name}
          </Text>
        )}
      </Text>
      <Icon as={LuChevronDown} boxSize={3} color="fg.subtle" flexShrink={0} />
    </HStack>
  );

  return (
    <Menu.Root>
      <Menu.Trigger asChild>{trigger}</Menu.Trigger>
      <Menu.Positioner zIndex={2000}>
        <Menu.Content minW="240px" bg="bg.surface" borderColor="border.default" shadow="lg" py={1} px={0}>
          {OPTIONS.map((opt) => {
            const selected = opt.id === value.agentId;
            return (
              <Menu.Item
                key={opt.id}
                value={opt.id}
                px={3}
                py={2}
                cursor="pointer"
                bg={selected ? 'bg.muted' : 'transparent'}
                _hover={{ bg: 'bg.emphasis' }}
                // Selecting from the dropdown clears the business unit — the
                // wizard re-scopes it when relevant.
                onClick={() => onChange({ agentId: opt.id })}
              >
                <HStack gap={2} justify="space-between" w="100%">
                  <HStack gap={2} minW={0} flex={1}>
                    <Icon as={opt.icon} boxSize={4} color={opt.color} flexShrink={0} />
                    <Box minW={0}>
                      <Text fontSize="xs" fontWeight={selected ? '700' : '500'} truncate>
                        {opt.name}
                      </Text>
                      <Text fontSize="2xs" color="fg.muted" fontFamily="mono" truncate>
                        {opt.role}
                      </Text>
                    </Box>
                  </HStack>
                  {selected && <Icon as={LuCheck} boxSize={3.5} color="fg.muted" flexShrink={0} strokeWidth={2.5} />}
                </HStack>
              </Menu.Item>
            );
          })}
        </Menu.Content>
      </Menu.Positioner>
    </Menu.Root>
  );
}

export default memo(AgentSelectorInner, (prev, next) => shallowEqualExcept(prev, next, ['onChange']));
