'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Box, VStack, HStack, Text, IconButton, Button, createListCollection } from '@chakra-ui/react';
import { SelectRoot, SelectTrigger, SelectContent, SelectItem, SelectValueText } from '@/components/ui/select';
import { LuChevronDown, LuChevronRight, LuDownload, LuRefreshCw } from 'react-icons/lu';
import { AppState } from '@/lib/appState';
import AppStateViewer from './AppStateViewer';
import { getRegisteredToolNames, executeToolCall } from '@/lib/api/tool-handlers';
import { UserInputException, type UserInputProps, type UserInput } from '@/lib/api/user-input-exception';
import { getStore } from '@/store/store';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import type { ToolCall, DatabaseWithSchema } from '@/lib/types';
import { uploadFile } from '@/lib/object-store/client';
import { useScreenshot } from '@/lib/hooks/useScreenshot';
import { extractChartEntries } from '@/lib/chart/chart-attachments';
import { clientChartImageRenderer } from '@/lib/chart/ChartImageRenderer.client';

interface DevToolsPanelProps {
  appState: AppState | null | undefined;
}

// OpenAI function tool schema format from describe_tool()
interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type?: string; description?: string }>;
      required: string[];
    };
  };
}

function ToolTester() {
  const [selectedTool, setSelectedTool] = useState('');
  const [argsJson, setArgsJson] = useState('{}');
  const [result, setResult] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [toolSchemas, setToolSchemas] = useState<ToolSchema[]>([]);
  const [pendingInput, setPendingInput] = useState<UserInputProps | null>(null);
  const frontendToolNames = useMemo(() => getRegisteredToolNames(), []);
  const dispatch = useAppDispatch();

  // Index schemas by tool name for quick lookup
  const schemasByName = useMemo(() => {
    const map: Record<string, ToolSchema> = {};
    for (const s of toolSchemas) map[s.function.name] = s;
    return map;
  }, [toolSchemas]);

  // Fetch tool schemas from Python backend on mount
  useEffect(() => {
    fetch('/api/tools/schema')
      .then(res => res.json())
      .then((data: ToolSchema[]) => setToolSchemas(data))
      .catch(() => {}); // silently fail - schemas are optional
  }, []);

  // Merge backend tool names with frontend-only tools
  const toolNames = useMemo(() => {
    const allNames = new Set([...Object.keys(schemasByName), ...frontendToolNames]);
    return Array.from(allNames).sort();
  }, [schemasByName, frontendToolNames]);

  const toolCollection = useMemo(() => createListCollection({
    items: toolNames.map(name => ({ label: name, value: name })),
  }), [toolNames]);

  // Prefill args JSON when tool selection changes
  const handleToolChange = useCallback((name: string) => {
    setSelectedTool(name);
    setResult(null);
    setPendingInput(null);
    const schema = schemasByName[name];
    const props = schema?.function.parameters.properties;
    if (props && Object.keys(props).length > 0) {
      const stub: Record<string, any> = {};
      for (const key of Object.keys(props)) {
        stub[key] = null;
      }
      setArgsJson(JSON.stringify(stub, null, 2));
    } else {
      setArgsJson('{}');
    }
  }, [schemasByName]);

  const runTool = useCallback(async (userInputs?: UserInput[]) => {
    if (!selectedTool) return;
    setIsRunning(true);
    setResult(null);
    setPendingInput(null);
    try {
      const parsedArgs = JSON.parse(argsJson);
      const state = getStore().getState();
      const database: DatabaseWithSchema = { databaseName: '', schemas: [] };

      const toolCall: ToolCall = {
        id: `dev-${Date.now()}`,
        type: 'function',
        function: { name: selectedTool, arguments: parsedArgs },
      };

      const toolResult = await executeToolCall(toolCall, database, dispatch, undefined, state, userInputs);
      setResult(JSON.stringify(JSON.parse(toolResult.content), null, 2));
    } catch (err: any) {
      if (err instanceof UserInputException) {
        setPendingInput(err.props);
      } else {
        setResult(`Error: ${err.message || String(err)}`);
      }
    } finally {
      setIsRunning(false);
    }
  }, [selectedTool, argsJson, dispatch]);

  const handleRun = useCallback(() => runTool(), [runTool]);

  const respondToInput = useCallback((response: any) => {
    if (!pendingInput) return;
    const userInput: UserInput = {
      id: `dev-input-${Date.now()}`,
      props: pendingInput,
      result: response,
      providedAt: new Date().toISOString(),
    };
    runTool([userInput]);
  }, [pendingInput, runTool]);

  return (
    <Box borderWidth="1px" borderColor="border.default" borderRadius="md" p={3} bg="bg.surface">
      <VStack align="stretch" gap={2}>
        <Text fontSize="xs" fontWeight="600" color="fg.muted">Tool Tester</Text>
        <SelectRoot
          collection={toolCollection}
          value={selectedTool ? [selectedTool] : []}
          onValueChange={(e) => handleToolChange(e.value[0] || '')}
          size="xs"
          positioning={{ sameWidth: true, placement: 'bottom' }}
        >
          <SelectTrigger>
            <SelectValueText placeholder="Select a tool..." fontFamily="mono" fontSize="2xs" />
          </SelectTrigger>
          <SelectContent maxH="300px" overflowY="auto" fontFamily="mono" fontSize="2xs">
            {toolNames.map((name) => (
              <SelectItem key={name} item={name}>{name}</SelectItem>
            ))}
          </SelectContent>
        </SelectRoot>
        <textarea
          value={argsJson}
          onChange={(e) => setArgsJson(e.target.value)}
          placeholder="Arguments (JSON)"
          rows={4}
          style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid var(--chakra-colors-border)', background: 'transparent', fontFamily: 'var(--font-mono)', fontSize: '11px', resize: 'vertical' }}
        />
        <Button size="xs" colorPalette="teal" onClick={handleRun} loading={isRunning} disabled={!selectedTool || isRunning}>
          Run
        </Button>

        {/* User input prompt */}
        {pendingInput && (
          <Box p={2} borderRadius="sm" bg="bg.subtle" borderWidth="1px" borderColor="accent.teal">
            <VStack align="stretch" gap={2}>
              <Text fontSize="2xs" fontWeight="600" fontFamily="mono">{pendingInput.title}</Text>
              {pendingInput.message && (
                <Text fontSize="2xs" fontFamily="mono" color="fg.muted">{pendingInput.message}</Text>
              )}
              {pendingInput.type === 'confirmation' && (
                <HStack gap={2}>
                  <Button size="2xs" colorPalette="teal" onClick={() => respondToInput(true)}>
                    {pendingInput.confirmText || 'Yes'}
                  </Button>
                  <Button size="2xs" variant="outline" onClick={() => respondToInput(false)}>
                    {pendingInput.cancelText || 'No'}
                  </Button>
                </HStack>
              )}
              {pendingInput.type === 'choice' && pendingInput.options && (
                <VStack align="stretch" gap={1}>
                  {pendingInput.options.map((opt, i) => (
                    <Button key={i} size="2xs" variant="outline" onClick={() => respondToInput(opt)}>
                      {opt.label}
                    </Button>
                  ))}
                </VStack>
              )}
            </VStack>
          </Box>
        )}

        {result !== null && (
          <Box
            as="pre"
            p={2}
            borderRadius="sm"
            bg="bg.subtle"
            borderWidth="1px"
            borderColor="border.default"
            fontSize="2xs"
            fontFamily="mono"
            overflowX="auto"
            maxH="200px"
            overflowY="auto"
            whiteSpace="pre-wrap"
            wordBreak="break-all"
          >
            {result}
          </Box>
        )}
      </VStack>
    </Box>
  );
}

// ── Image Tools test panel ────────────────────────────────────────────────────

type ImageItem = { label: string; dataUrl?: string; url?: string };
type ImageResult =
  | { kind: 'items'; items: ImageItem[] }
  | { kind: 'error'; error: string; label: string };

const checkboxStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontFamily: 'var(--font-mono)', cursor: 'pointer', userSelect: 'none' };

function ImageToolsPanel({ fileId, appState }: { fileId: number | undefined; appState: AppState | null | undefined }) {
  const [webLink, setWebLink] = useState(false);
  const [limit512, setLimit512] = useState(false);  // cap output to 512px wide
  const [busy, setBusy] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [result, setResult] = useState<ImageResult | null>(null);
  // Memoized so captureElement's useCallback deps don't change on every render
  const screenshotOptions = useMemo(() => limit512 ? { maxWidth: 512 } : undefined, [limit512]);
  const { captureFileView, blobToDataURL, download } = useScreenshot(screenshotOptions);
  const colorMode = useAppSelector(state => state.ui.colorMode);
  const queryResultsMap = useAppSelector(state => state.queryResults.results);

  // Pre-capture state — all hooks must be above the early return
  const captureCache = useRef<Blob | null>(null);
  const captureGenRef = useRef(0);
  const [captureStatus, setCaptureStatus] = useState<'idle' | 'capturing' | 'ready' | 'error'>('idle');

  const triggerPreCapture = useCallback(async (gen: number) => {
    if (fileId === undefined) return;
    setCaptureStatus('capturing');
    captureCache.current = null;
    try {
      const blob = await captureFileView(fileId); // viewport-only — no fullHeight, no 100ms wait
      if (captureGenRef.current !== gen) return;  // discard if superseded
      captureCache.current = blob;
      setCaptureStatus('ready');
    } catch {
      if (captureGenRef.current !== gen) return;
      setCaptureStatus('error');
    }
  }, [fileId, captureFileView]);

  // Pre-capture on mount and whenever fileId or screenshot options change
  useEffect(() => {
    if (fileId === undefined) return;
    const gen = ++captureGenRef.current;
    captureCache.current = null;
    setCaptureStatus('idle');
    // 150ms delay: lets the file view finish its initial paint before capturing
    const timer = setTimeout(() => triggerPreCapture(gen), 150);
    return () => clearTimeout(timer);
  }, [fileId, captureFileView, triggerPreCapture]);

  if (fileId === undefined) return null;

  const handleAgentImage = async () => {
    setAgentBusy(true);
    setResult(null);
    try {
      const entries = extractChartEntries(appState, queryResultsMap);
      if (entries.length === 0) {
        setResult({ kind: 'error', error: 'No renderable charts found for this file', label: 'Agent Image' });
        return;
      }
      const rendered = await clientChartImageRenderer.renderCharts(
        entries,
        { width: 512, colorMode, addWatermark: false, padding: false },
      );
      if (rendered.length === 0) {
        setResult({ kind: 'error', error: 'Renderer returned no images', label: 'Agent Image' });
        return;
      }
      setResult({ kind: 'items', items: rendered.map(r => ({ label: r.label, dataUrl: r.dataUrl })) });
    } catch (err: any) {
      setResult({ kind: 'error', error: err.message ?? String(err), label: 'Agent Image' });
    } finally {
      setAgentBusy(false);
    }
  };

  const handleDownload = async () => {
    setBusy(true);
    setResult(null);
    try {
      // Instant path: serve pre-captured blob; fall back to live capture if not ready
      const blob = captureCache.current ?? await captureFileView(fileId);
      const dataUrl = await blobToDataURL(blob);
      const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      download(blob, `screenshot-${ts}.jpg`);

      let url: string | undefined;
      if (webLink) {
        const file = new File([blob], 'screenshot.jpg', { type: 'image/jpeg' });
        ({ publicUrl: url } = await uploadFile(file, undefined, { keyType: 'charts' }));
      }
      setResult({ kind: 'items', items: [{ label: 'Screenshot', dataUrl, url }] });

      // Refresh cache in background for next click
      const gen = ++captureGenRef.current;
      captureCache.current = null;
      setCaptureStatus('capturing');
      triggerPreCapture(gen);
    } catch (err: any) {
      setResult({ kind: 'error', error: err.message ?? String(err), label: 'Download' });
    } finally {
      setBusy(false);
    }
  };

  const handleRefresh = () => {
    const gen = ++captureGenRef.current;
    captureCache.current = null;
    triggerPreCapture(gen);
  };

  return (
    <Box borderWidth="1px" borderColor="border.default" borderRadius="md" p={3} bg="bg.surface">
      <VStack align="stretch" gap={2}>
        <Text fontSize="xs" fontWeight="600" color="fg.muted">Image Tools</Text>

        <HStack gap={2} align="center" flexWrap="wrap">
          <label style={checkboxStyle}>
            <input type="checkbox" checked={webLink} onChange={e => setWebLink(e.target.checked)} aria-label="Upload to S3 and return web link" />
            <Text fontSize="2xs" color="fg.muted">Web link</Text>
          </label>
          <label style={checkboxStyle}>
            <input type="checkbox" checked={limit512} onChange={e => setLimit512(e.target.checked)} aria-label="Limit width to 512px" />
            <Text fontSize="2xs" color="fg.muted">512px</Text>
          </label>
        </HStack>

        <HStack gap={2} align="center">
          <Button size="2xs" variant="outline" onClick={handleDownload} loading={busy}
            aria-label="Download image">
            <LuDownload />Download image
          </Button>
          {/* Pre-capture status dot */}
          <Box
            w="6px" h="6px" borderRadius="full" flexShrink={0}
            bg={captureStatus === 'ready' ? 'green.500' : captureStatus === 'capturing' ? 'yellow.400' : captureStatus === 'error' ? 'red.400' : 'transparent'}
            title={captureStatus}
          />
          <IconButton
            size="2xs" variant="ghost"
            onClick={handleRefresh}
            disabled={captureStatus === 'capturing'}
            aria-label="Refresh screenshot cache"
          >
            <LuRefreshCw />
          </IconButton>
          <Button size="2xs" variant="outline" onClick={handleAgentImage} loading={agentBusy}
            aria-label="Agent image">
            Agent image
          </Button>
        </HStack>

        {result && (
          <VStack gap={2} align="stretch">
            {result.kind === 'error' ? (
              <Box p={2} bg="accent.danger/10" borderRadius="sm" borderWidth="1px" borderColor="border.default">
                <Text fontSize="2xs" fontFamily="mono" color="accent.danger">{result.error}</Text>
              </Box>
            ) : (
              result.items.map((item, i) => (
                <Box key={i} borderWidth="1px" borderColor="border.default" borderRadius="sm" overflow="hidden">
                  <HStack justify="space-between" px={2} pt={2} pb={1}>
                    <Text fontSize="2xs" fontFamily="mono" color="fg.muted">{item.label}</Text>
                  </HStack>
                  {item.dataUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.dataUrl} alt={item.label} style={{ width: '100%', height: 'auto', display: 'block' }} />
                  )}
                  {item.url && (
                    <Box px={2} pb={2}>
                      <Text fontSize="2xs" fontFamily="mono" color="accent.teal" cursor="pointer" wordBreak="break-all"
                        onClick={() => navigator.clipboard.writeText(item.url!)} title="Click to copy">
                        {item.url}
                      </Text>
                    </Box>
                  )}
                </Box>
              ))
            )}
          </VStack>
        )}
      </VStack>
    </Box>
  );
}

export default function DevToolsPanel({ appState }: DevToolsPanelProps) {
  const [appStateOpen, setAppStateOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);

  const fileId = appState?.type === 'file' ? appState.state.fileState.id : undefined;
  const fileAnalytics = useAppSelector(state =>
    fileId !== undefined ? state.files.files[fileId]?.analytics : undefined
  );

  return (
    <Box p={4}>
      <VStack align="stretch" gap={3}>
        <Text fontSize="sm" fontFamily="mono" color="accent.teal" fontWeight="600">
          Development Mode Active
        </Text>

        {/* Image Tools */}
        <ImageToolsPanel fileId={fileId} appState={appState} />

        {/* App State (collapsible) */}
        <Box borderWidth="1px" borderColor="border.default" borderRadius="md" bg="bg.surface" overflow="hidden">
          <HStack
            px={3} py={2}
            cursor="pointer"
            onClick={() => setAppStateOpen(!appStateOpen)}
            _hover={{ bg: 'bg.subtle' }}
          >
            <Box as={appStateOpen ? LuChevronDown : LuChevronRight} fontSize="xs" color="fg.muted" />
            <Text fontSize="xs" fontWeight="600" color="fg.muted">App State</Text>
          </HStack>
          {appStateOpen && (
            <Box px={3} pb={3}>
              <AppStateViewer appState={appState} maxHeight="400px" />
            </Box>
          )}
        </Box>

        {/* Analytics (collapsible, file only) */}
        {appState?.type === 'file' && (
          <Box borderWidth="1px" borderColor="border.default" borderRadius="md" bg="bg.surface" overflow="hidden">
            <HStack
              px={3} py={2}
              cursor="pointer"
              onClick={() => setAnalyticsOpen(!analyticsOpen)}
              _hover={{ bg: 'bg.subtle' }}
            >
              <Box as={analyticsOpen ? LuChevronDown : LuChevronRight} fontSize="xs" color="fg.muted" />
              <Text fontSize="xs" fontWeight="600" color="fg.muted">Analytics</Text>
            </HStack>
            {analyticsOpen && (
              <Box px={3} pb={3}>
                <Box
                  as="pre"
                  p={2}
                  borderRadius="sm"
                  bg="bg.subtle"
                  borderWidth="1px"
                  borderColor="border.default"
                  fontSize="2xs"
                  fontFamily="mono"
                  overflowX="auto"
                  maxH="300px"
                  overflowY="auto"
                  whiteSpace="pre-wrap"
                  wordBreak="break-all"
                >
                  {JSON.stringify(fileAnalytics ?? null, null, 2)}
                </Box>
              </Box>
            )}
          </Box>
        )}

        {/* Tool Tester */}
        <ToolTester />
      </VStack>
    </Box>
  );
}
