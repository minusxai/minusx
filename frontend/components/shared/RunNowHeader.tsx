'use client';

import { useState } from 'react';
import { Box, Button, Flex, HStack, Portal, Switch, Text } from '@chakra-ui/react';
import type { CheckedChangeDetails } from '@zag-js/switch';
import Link from 'next/link';
import { LuExternalLink, LuHistory, LuPlay } from 'react-icons/lu';
import { createListCollection } from '@chakra-ui/react';
import { SelectRoot, SelectTrigger, SelectPositioner, SelectContent, SelectItem, SelectValueText } from '@/components/ui/select';
import { preserveParams } from '@/lib/navigation/url-utils';
import type { JobRun } from '@/lib/types';

export interface RunOptions {
  force: boolean;
  send: boolean;
}

interface RunNowHeaderProps {
  title: string;
  runs: JobRun[];
  selectedRunId?: number | null;
  onSelectRun?: (runId: number | null) => void;
  isRunning: boolean;
  /** Disables the run button (e.g. isDirty, no items configured) */
  disabled: boolean;
  onRunNow: (opts: RunOptions) => void;
  /** Primary button label. Default: "Run Now" */
  buttonLabel?: string;
  /** Primary button loading label. Default: "Running..." */
  runningLabel?: string;
  /** If provided, renders a secondary "Test Only" outline button */
  onTestOnly?: (opts: RunOptions) => void;
  /** If true, shows "Refreshing schema..." indicator */
  schemaRefreshing?: boolean;
  /** If provided, renders an external link icon to /f/{externalLinkId} */
  externalLinkId?: number;
}

export function RunNowHeader({
  title,
  runs,
  selectedRunId,
  onSelectRun,
  isRunning,
  disabled,
  onRunNow,
  buttonLabel = 'Run Now',
  runningLabel = 'Running...',
  onTestOnly,
  schemaRefreshing,
  externalLinkId,
}: RunNowHeaderProps) {
  const [forceRun, setForceRun] = useState(false);
  const [sendNotifications, setSendNotifications] = useState(true);

  const runOptions: RunOptions = { force: forceRun, send: sendNotifications };

  const runsCollection = createListCollection({
    items: runs.map(r => ({
      value: r.id.toString(),
      label: new Date(r.created_at).toLocaleString(),
    })),
  });

  return (
    <Flex
      justify="space-between"
      align="center"
      px={4}
      py={3}
      borderBottomWidth="1px"
      borderColor="border.muted"
      gap={2}
    >
      <HStack flex={1} gap={2}>
        <LuHistory size={16} />
        <Text fontWeight="600" fontSize="sm">{title}</Text>
        {runs.length > 0 && (
          <Box flex={1} maxW="200px">
            <SelectRoot
              collection={runsCollection}
              value={selectedRunId ? [selectedRunId.toString()] : []}
              onValueChange={(e) => onSelectRun?.(e.value[0] ? parseInt(e.value[0], 10) : null)}
              size="sm"
            >
              <SelectTrigger>
                <SelectValueText placeholder="Select run..." />
              </SelectTrigger>
              <Portal>
                <SelectPositioner>
                  <SelectContent>
                    {runsCollection.items.map((item) => (
                      <SelectItem key={item.value} item={item}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </SelectPositioner>
              </Portal>
            </SelectRoot>
          </Box>
        )}
      </HStack>

      <HStack gap={3}>
        <HStack gap={1.5}>
          <Switch.Root
            size="sm"
            checked={forceRun}
            onCheckedChange={(e: CheckedChangeDetails) => setForceRun(e.checked)}
            colorPalette="orange"
          >
            <Switch.HiddenInput />
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Root>
          <Text fontSize="xs" color="fg.muted">Force</Text>
        </HStack>

        <HStack gap={1.5}>
          <Switch.Root
            size="sm"
            checked={sendNotifications}
            onCheckedChange={(e: CheckedChangeDetails) => setSendNotifications(e.checked)}
            colorPalette="teal"
          >
            <Switch.HiddenInput />
            <Switch.Control>
              <Switch.Thumb />
            </Switch.Control>
          </Switch.Root>
          <Text fontSize="xs" color="fg.muted">Send</Text>
        </HStack>

        {schemaRefreshing && (
          <Text fontSize="xs" color="fg.muted" fontStyle="italic">Refreshing schema...</Text>
        )}

        {externalLinkId && (
          <Link href={preserveParams(`/f/${externalLinkId}`)}>
            <Button size="sm" variant="ghost" colorPalette="gray">
              <LuExternalLink size={14} />
            </Button>
          </Link>
        )}

        {onTestOnly && (
          <Button
            onClick={() => onTestOnly(runOptions)}
            disabled={disabled}
            size="sm"
            variant="outline"
            colorPalette="gray"
          >
            <LuPlay size={14} />
            {isRunning ? runningLabel : 'Test Only'}
          </Button>
        )}

        <Button
          onClick={() => onRunNow(runOptions)}
          disabled={disabled && !forceRun}
          size="sm"
          colorPalette="teal"
        >
          <LuPlay size={14} />
          {isRunning ? runningLabel : buttonLabel}
        </Button>
      </HStack>
    </Flex>
  );
}
