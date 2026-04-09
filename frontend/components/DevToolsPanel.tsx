'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { Box, VStack, HStack, Text, IconButton, Button, createListCollection } from '@chakra-ui/react';
import { SelectRoot, SelectTrigger, SelectContent, SelectItem, SelectValueText } from '@/components/ui/select';
import { LuChevronDown, LuChevronRight, LuDownload, LuLink, LuServer } from 'react-icons/lu';
import { AppState } from '@/lib/appState';
import AppStateViewer from './AppStateViewer';
import { getRegisteredToolNames, executeToolCall } from '@/lib/api/tool-handlers';
import { UserInputException, type UserInputProps, type UserInput } from '@/lib/api/user-input-exception';
import { getStore } from '@/store/store';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import type { ToolCall, DatabaseWithSchema } from '@/lib/types';
import { uploadFile } from '@/lib/object-store/client';
import { toJpegObjectUrl } from '@/lib/chart/render-chart-client';
import type { VizSettings } from '@/lib/types.gen';
import { RENDERABLE_CHART_TYPES } from '@/lib/chart/render-chart-svg';
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

const inputStyle: React.CSSProperties = {
  width: 52,
  padding: '2px 4px',
  borderRadius: 4,
  border: '1px solid var(--chakra-colors-border-default)',
  background: 'transparent',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  color: 'inherit',
};

const checkboxStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontFamily: 'var(--font-mono)', cursor: 'pointer', userSelect: 'none' };

function ImageToolsPanel({ appState }: { appState: AppState | null | undefined }) {
  const [imgWidth, setImgWidth] = useState(512);
  const [addWatermark, setAddWatermark] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ImageResult | null>(null);
  const colorMode = useAppSelector(state => state.ui.colorMode) as 'light' | 'dark';
  const queryResultsMap = useAppSelector(state => state.queryResults.results);

  if (appState?.type !== 'file') return null;
  const { fileState, references } = appState.state;
  if (fileState.type !== 'question' && fileState.type !== 'dashboard') return null;

  const questionContent = fileState.type === 'question' ? (fileState.content as any) : null;
  const vizSettings: VizSettings | null = questionContent?.vizSettings ?? null;
  const queryResultId: string | null = (fileState as any).queryResultId ?? null;
  const queryResult = queryResultId ? (queryResultsMap[queryResultId]?.data ?? null) : null;

  // Single chart: question with renderable viz and data
  const singleChart = fileState.type === 'question' && !!vizSettings && !!queryResult && RENDERABLE_CHART_TYPES.has(vizSettings.type)
    ? { queryResult, vizSettings, name: fileState.name || undefined }
    : null;

  // Dashboard charts: renderable questions with data
  const dashboardCharts = fileState.type === 'dashboard'
    ? (references ?? []).flatMap(ref => {
        const vs = (ref.content as any)?.vizSettings as VizSettings | undefined;
        const qrId = (ref as any).queryResultId as string | undefined;
        const qr = qrId ? (queryResultsMap[qrId]?.data ?? null) : null;
        if (vs && qr && RENDERABLE_CHART_TYPES.has(vs.type)) return [{ vizSettings: vs, queryResult: qr, name: ref.name || undefined }];
        return [];
      })
    : [];

  const hasCharts = !!(singleChart || dashboardCharts.length > 0);
  const noChartHint = 'No renderable charts with data found';

  const run = async (label: string, fn: () => Promise<ImageResult>) => {
    setBusy(label);
    setResult(null);
    try {
      setResult(await fn());
    } catch (err: any) {
      setResult({ kind: 'error', error: err.message ?? String(err), label });
    } finally {
      setBusy(null);
    }
  };

  const chartInputs = singleChart
    ? [{ queryResult: singleChart.queryResult, vizSettings: singleChart.vizSettings, titleOverride: singleChart.name }]
    : dashboardCharts.map(c => ({ queryResult: c.queryResult, vizSettings: c.vizSettings, titleOverride: c.name }));

  const handleECharts = () => run('ECharts', async () => {
    const rendered = await clientChartImageRenderer.renderCharts(chartInputs, { width: imgWidth, colorMode, addWatermark });
    if (rendered.length === 0) throw new Error('No charts rendered — unsupported viz type or empty data');
    return { kind: 'items' as const, items: rendered.map(r => ({ label: r.label, dataUrl: r.dataUrl })) };
  });

  const handleS3ECharts = () => run('S3 ECharts', async () => {
    const rendered = await clientChartImageRenderer.renderCharts(chartInputs, { width: imgWidth, colorMode, addWatermark });
    if (rendered.length === 0) throw new Error('No charts rendered — unsupported viz type or empty data');
    const items: ImageItem[] = [];
    for (const r of rendered) {
      const jpegBlob = await fetch(r.dataUrl).then(res => res.blob());
      const file = new File([jpegBlob], 'chart.jpg', { type: 'image/jpeg' });
      const { publicUrl } = await uploadFile(file, undefined, { keyType: 'charts' });
      items.push({ label: r.label, url: publicUrl });
    }
    return { kind: 'items' as const, items };
  });

  const handleServer = () => run('Server', async () => {
    const serverW = imgWidth;
    const serverH = Math.round(serverW * 0.5625); // 16:9
    const res = await fetch('/api/dev/render-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        singleChart
          ? { mode: 'single' as const, queryResult: singleChart.queryResult, vizSettings: singleChart.vizSettings, titleOverride: singleChart.name, colorMode, width: serverW, height: serverH }
          : { mode: 'dashboard' as const, charts: dashboardCharts.map(c => ({ queryResult: c.queryResult, vizSettings: c.vizSettings, titleOverride: c.name })), colorMode, width: serverW, height: serverH },
      ),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Server error ${res.status}`);
    }

    const items: ImageItem[] = [];

    if (singleChart) {
      const { dataUrl: rawDataUrl } = await res.json() as { dataUrl: string };
      const dataUrl = addWatermark ? await toJpegObjectUrl(rawDataUrl, imgWidth, true, colorMode) : rawDataUrl;
      const jpegBlob = await fetch(dataUrl).then(r => r.blob());
      const file = new File([jpegBlob], 'server-render.jpg', { type: 'image/jpeg' });
      const { publicUrl } = await uploadFile(file, undefined, { keyType: 'charts' });
      items.push({ label: singleChart.name ?? 'Chart', dataUrl, url: publicUrl });
    } else {
      const { images } = await res.json() as { images: string[] };
      for (let i = 0; i < images.length; i++) {
        const rawDataUrl = images[i];
        const label = dashboardCharts[i]?.name ?? `Chart ${i + 1}`;
        const dataUrl = addWatermark ? await toJpegObjectUrl(rawDataUrl, imgWidth, true, colorMode) : rawDataUrl;
        const jpegBlob = await fetch(dataUrl).then(r => r.blob());
        const file = new File([jpegBlob], `server-render-${i}.jpg`, { type: 'image/jpeg' });
        const { publicUrl } = await uploadFile(file, undefined, { keyType: 'charts' });
        items.push({ label, dataUrl, url: publicUrl });
      }
    }

    return { kind: 'items' as const, items };
  });

  const triggerDownload = (dataUrl: string, label: string) => {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${label.toLowerCase().replace(/\s+/g, '-')}.jpg`;
    a.click();
  };

  return (
    <Box borderWidth="1px" borderColor="border.default" borderRadius="md" p={3} bg="bg.surface">
      <VStack align="stretch" gap={2}>
        <Text fontSize="xs" fontWeight="600" color="fg.muted">Image Tools</Text>

        {/* Dimensions + watermark */}
        <HStack gap={2} align="center">
          <Text fontSize="2xs" color="fg.subtle" fontFamily="mono">Max W</Text>
          <input type="number" value={imgWidth} min={64} max={2048}
            onChange={e => setImgWidth(Number(e.target.value))} style={inputStyle} aria-label="Max image width" />
          <label style={checkboxStyle}>
            <input type="checkbox" checked={addWatermark} onChange={e => setAddWatermark(e.target.checked)} aria-label="Add watermark" />
            <Text fontSize="2xs" color="fg.muted">Watermark</Text>
          </label>
        </HStack>

        {/* Action buttons */}
        <HStack gap={1} flexWrap="wrap">
          <Button size="2xs" variant="outline" onClick={handleECharts} loading={busy === 'ECharts'}
            disabled={!hasCharts} title={!hasCharts ? noChartHint : undefined} aria-label="ECharts export">
            <LuDownload />ECharts
          </Button>
          <Button size="2xs" variant="outline" onClick={handleS3ECharts} loading={busy === 'S3 ECharts'}
            disabled={!hasCharts} title={!hasCharts ? noChartHint : undefined} aria-label="S3 ECharts upload">
            <LuLink />S3
          </Button>
          <Button size="2xs" variant="outline" onClick={handleServer} loading={busy === 'Server'}
            disabled={!hasCharts} title={!hasCharts ? noChartHint : undefined} aria-label="Server render">
            <LuServer />Server
          </Button>
        </HStack>

        {/* Result: one card per chart */}
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
                    <HStack gap={1}>
                      {item.url && (
                        <Text fontSize="2xs" fontFamily="mono" color="accent.teal" cursor="pointer"
                          onClick={() => navigator.clipboard.writeText(item.url!)} title="Click to copy URL">
                          S3 ↗
                        </Text>
                      )}
                      {item.dataUrl && (
                        <IconButton size="2xs" variant="ghost" aria-label="Download image"
                          onClick={() => triggerDownload(item.dataUrl!, item.label)}>
                          <LuDownload />
                        </IconButton>
                      )}
                    </HStack>
                  </HStack>
                  {item.dataUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.dataUrl} alt={item.label} style={{ width: '100%', height: 'auto', display: 'block' }} />
                  )}
                  {!item.dataUrl && item.url && (
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
        <ImageToolsPanel appState={appState} />

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
