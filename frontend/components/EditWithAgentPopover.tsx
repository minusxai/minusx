'use client';

/**
 * EditWithAgentPopover — a floating "Interact with {agentName}" affordance anchored
 * to a text selection. Two states: a compact PILL (default) that, when clicked,
 * expands into a small command card with an Ask / Edit segmented control and a
 * composer input. Pressing Enter sends the selection (as a visible chip) plus the
 * action-framed instruction to chat (see lib/chat/edit-with-agent.ts).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Box, HStack, Input, IconButton, Icon, Text, Portal } from '@chakra-ui/react';
import { LuSparkles, LuArrowUp, LuMessageSquare, LuPencilLine } from 'react-icons/lu';
import { useConfigs } from '@/lib/hooks/useConfigs';
import {
  useEditWithAgent,
  AGENT_ACTIONS,
  DEFAULT_AGENT_ACTION,
  type AgentActionKey,
  type EditWithAgentSource,
} from '@/lib/chat/edit-with-agent';

interface EditWithAgentPopoverProps {
  /** Viewport coords (anchor below the selection). Null hides everything. */
  position: { x: number; y: number } | null;
  selectedText: string;
  source: EditWithAgentSource;
  onClose: () => void;
  /** Called when the user opens the card — lets a host (e.g. the Lexical plugin) pin the popover. */
  onInteractStart?: () => void;
}

const ACTION_ICON = { ask: LuMessageSquare, edit: LuPencilLine } as const;

export default function EditWithAgentPopover({ position, selectedText, source, onClose, onInteractStart }: EditWithAgentPopoverProps) {
  const { config } = useConfigs();
  const agentName = config.branding.agentName;
  const sendInteract = useEditWithAgent();

  const cardRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'pill' | 'input'>('pill');
  const [actionKey, setActionKey] = useState<AgentActionKey>(DEFAULT_AGENT_ACTION);
  const [instruction, setInstruction] = useState('');
  const [entered, setEntered] = useState(false);

  const action = AGENT_ACTIONS.find((a) => a.key === actionKey) ?? AGENT_ACTIONS[0];

  // Reset to the pill whenever the anchor/selection changes — "reset on prop change".
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode('pill');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActionKey(DEFAULT_AGENT_ACTION);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInstruction('');
  }, [position, selectedText]);

  // Subtle entrance when the card expands.
  useEffect(() => {
    if (mode !== 'input') return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntered(false);
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, [mode]);

  // Close on outside click / Escape (guarded so popover clicks don't close it).
  useEffect(() => {
    if (!position) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) onClose();
    };
    const handleEscape = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [position, onClose]);

  const openCard = useCallback((key: AgentActionKey) => {
    onInteractStart?.();
    setActionKey(key);
    setMode('input');
  }, [onInteractStart]);

  const handleSend = useCallback(() => {
    const trimmed = instruction.trim();
    if (!trimmed) return;
    sendInteract({ selectedText, instruction: trimmed, action, source });
    onClose();
  }, [instruction, sendInteract, selectedText, action, source, onClose]);

  if (!position || !selectedText.trim()) return null;

  // Clamp to viewport (DrillDownCard pattern).
  const cardW = mode === 'input' ? 340 : 280;
  const cardH = 104;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const x = Math.max(8, Math.min(position.x, vw - cardW - 8));
  const spaceBelow = vh - position.y;
  const y = spaceBelow < cardH + 8 ? Math.max(8, position.y - cardH - 24) : Math.min(position.y, vh - cardH - 8);

  return (
    <Portal>
      <Box ref={cardRef} position="fixed" left={`${x}px`} top={`${y}px`} zIndex={1500}>
        {mode === 'pill' ? (
          <HStack
            aria-label={`Interact with ${agentName}`}
            // Keep the editor's selection alive while a pill button is pressed.
            onMouseDown={(e) => e.preventDefault()}
            gap={0.5}
            p="3px"
            pl={2.5}
            fontFamily="mono"
            bg="bg.surface"
            border="1px solid"
            borderColor="border.muted"
            borderRadius="full"
            boxShadow="sm"
            transition="box-shadow 0.12s ease, border-color 0.12s ease"
            _hover={{ boxShadow: 'md', borderColor: 'border.emphasized' }}
          >
            <Icon as={LuSparkles} boxSize={3} color="accent.teal" ml={0.5} />
            <Text as="span" fontSize="11px" color="fg.subtle" whiteSpace="nowrap">Interact with {agentName}</Text>
            <Box w="1px" h="14px" bg="border.muted" mx={1} />
            {AGENT_ACTIONS.map((a) => (
              <HStack
                as="button"
                key={a.key}
                aria-label={`${a.label} ${agentName}`}
                onClick={() => openCard(a.key)}
                gap={1}
                px={2}
                py={1}
                borderRadius="full"
                cursor="pointer"
                color="fg.default"
                fontWeight="600"
                transition="background 0.12s, color 0.12s"
                _hover={{ bg: 'bg.muted', color: 'accent.teal' }}
                css={{
                  '& svg': { color: 'var(--chakra-colors-fg-muted)', transition: 'color 0.12s' },
                  '&:hover svg': { color: 'var(--chakra-colors-accent-teal)' },
                }}
              >
                <Icon as={ACTION_ICON[a.key]} boxSize={3.5} />
                <Text as="span" fontSize="xs">{a.label}</Text>
              </HStack>
            ))}
          </HStack>
        ) : (
          <Box
            bg="bg.surface"
            border="1px solid"
            borderColor="border.muted"
            borderRadius="xl"
            boxShadow="xl"
            p={2.5}
            width="340px"
            fontFamily="mono"
            style={{
              opacity: entered ? 1 : 0,
              transform: entered ? 'none' : 'translateY(-4px) scale(0.985)',
              transition: 'opacity 0.14s ease, transform 0.14s cubic-bezier(0.16, 1, 0.3, 1)',
              transformOrigin: 'top left',
            }}
          >
            {/* Header: the chosen action's question */}
            <HStack gap={1.5} mb={2} px={0.5}>
              <Icon as={ACTION_ICON[action.key]} boxSize={3.5} color="accent.teal" />
              <Text fontSize="xs" fontWeight="600" color="fg.default">{action.prompt}</Text>
            </HStack>

            {/* Composer — soft filled field, teal ring on focus (no hard border) */}
            <HStack
              mt={0}
              pl={3}
              pr={1}
              h="36px"
              bg="bg.muted"
              border="1px solid"
              borderColor="transparent"
              borderRadius="lg"
              transition="border-color 0.15s, box-shadow 0.15s, background 0.15s"
              css={{
                '&:focus-within': {
                  background: 'var(--chakra-colors-bg-subtle)',
                  borderColor: 'var(--chakra-colors-accent-teal)',
                  boxShadow: '0 0 0 3px color-mix(in srgb, var(--chakra-colors-accent-teal) 18%, transparent)',
                },
              }}
            >
              <Input
                autoFocus
                border="none"
                outline="none"
                bg="transparent"
                px={0}
                h="full"
                size="sm"
                fontSize="xs"
                fontFamily="mono"
                color="fg.default"
                aria-label={`Message for ${agentName}`}
                placeholder={action.placeholder}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); handleSend(); }
                  else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
                }}
                _placeholder={{ color: 'fg.subtle' }}
                _focusVisible={{ boxShadow: 'none', borderColor: 'transparent' }}
                flex={1}
              />
              <IconButton
                aria-label={`Send to ${agentName}`}
                size="xs"
                variant="ghost"
                colorPalette="teal"
                disabled={!instruction.trim()}
                onClick={handleSend}
                borderRadius="full"
              >
                <LuArrowUp />
              </IconButton>
            </HStack>

            <Text mt={1.5} mr={0.5} fontSize="10px" color="fg.subtle" textAlign="right">↵ send · esc dismiss</Text>
          </Box>
        )}
      </Box>
    </Portal>
  );
}
