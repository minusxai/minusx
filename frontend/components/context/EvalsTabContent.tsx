'use client';

/**
 * EvalsTabContent - the "Evals" tab body of ContextEditorV2: eval list,
 * schedule/delivery config, run history, and the raw JSON editor variant.
 * Extracted from ContextEditorV2 — pure structural move, no behavior change.
 */

import { Box, HStack, Text, Tabs } from '@chakra-ui/react';
import type { ContextContent, Test, JobRun } from '@/lib/types';
import { SchedulePicker } from '@/components/shared/SchedulePicker';
import { DeliveryCard } from '@/components/shared/DeliveryPicker';
import { RunNowHeader, type RunOptions } from '@/components/shared/RunNowHeader';
import TestList from '../evals/TestList';
import ContextRunView from '../views/ContextRunView';
import Editor from '@monaco-editor/react';

const MONACO_READ_ONLY_MESSAGE = { value: 'Switch to edit mode to make changes.' };

interface EvalsTabContentProps {
  activeTab: 'picker' | 'yaml';
  colorMode: string;
  editMode: boolean;
  content: ContextContent;
  onChange: (updates: Partial<ContextContent>) => void;
  runs: JobRun[];
  isRunning: boolean;
  selectedRunId?: number | null;
  onRunAll?: (opts: RunOptions) => void;
  onSelectRun?: (runId: number | null) => void;
}

export function EvalsTabContent({
  activeTab,
  colorMode,
  editMode,
  content,
  onChange,
  runs,
  isRunning,
  selectedRunId,
  onRunAll,
  onSelectRun,
}: EvalsTabContentProps) {
  const evalsSelectedRun = runs.find(r => r.id === selectedRunId) ?? runs[0] ?? null;

  return (
    <Tabs.Content value="evals">
      {activeTab === 'picker' ? (
        <Box display="flex" flexDirection="row" gap={4} alignItems="stretch" minH="400px">
          {/* Left Panel: Evals list */}
          <Box
            flex={1}
            overflow="auto"
            border="1px solid"
            borderColor="border.muted"
            borderRadius="md"
            p={3}
          >
            <HStack mb={3} justify="space-between">
              <Text fontSize="xs" fontWeight="700" textTransform="uppercase" letterSpacing="wider" color="fg.muted">Evals</Text>
            </HStack>
            <TestList
              tests={content.evals || []}
              onChange={(evals: Test[]) => onChange({ evals })}
              editMode={editMode}
              forcedType="llm"
              alwaysShowAdd
              addLabel="Add eval"
            />

            <SchedulePicker
              schedule={{ cron: content.schedule?.cron || '0 9 * * 1', timezone: content.schedule?.timezone || 'America/New_York' }}
              onChange={(s) => onChange({ schedule: s })}
              editMode={editMode}
            />

            <DeliveryCard
              recipients={content.recipients || []}
              onChange={(recipients) => onChange({ recipients })}
              disabled={!editMode}
            />
          </Box>

          {/* Right Panel: Run history */}
          <Box
            flex={1}
            overflow="auto"
            border="1px solid"
            borderColor="border.muted"
            borderRadius="md"
            p={3}
          >
            <RunNowHeader
              title="Run History"
              runs={runs ?? []}
              selectedRunId={selectedRunId}
              onSelectRun={onSelectRun}
              isRunning={!!isRunning}
              disabled={!content.evals?.length}
              onRunNow={(opts) => onRunAll?.(opts)}
              buttonLabel="Run all"
            />
            {evalsSelectedRun?.output_file_id ? (
              <ContextRunView fileId={evalsSelectedRun.output_file_id} />
            ) : runs.length === 0 ? (
              <Text fontSize="sm" color="fg.muted">No runs yet. Click &quot;Run all&quot; to evaluate.</Text>
            ) : (
              <Text fontSize="sm" color="fg.muted">Run in progress...</Text>
            )}
          </Box>
        </Box>
      ) : (
        <Box
          border="1px solid"
          borderColor="border.default"
          borderRadius="md"
          overflow="hidden"
          minH="600px"
        >
          <Editor
            height="600px"
            language="json"
            value={JSON.stringify(content.evals || [], null, 2)}
            onChange={(value) => {
              try {
                const parsed = JSON.parse(value || '[]');
                if (Array.isArray(parsed)) onChange({ evals: parsed });
              } catch { /* ignore parse errors while typing */ }
            }}
            theme={colorMode === 'dark' ? 'vs-dark' : 'light'}
            options={{
              readOnly: !editMode,
              readOnlyMessage: MONACO_READ_ONLY_MESSAGE,
              minimap: { enabled: false },
              wordWrap: 'on',
              lineNumbers: 'on',
              fontSize: 14,
              fontFamily: 'var(--font-jetbrains-mono)',
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
            }}
          />
        </Box>
      )}
    </Tabs.Content>
  );
}
