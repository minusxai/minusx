'use client';

/**
 * ConnectionFormV2 - Props-based View Component (Phase 2)
 * Dumb component that receives all state via props
 *
 * Container manages:
 * - State management (via useFile hook + Redux)
 * - Save/cancel logic
 * - Dirty detection
 *
 * This component handles:
 * - UI rendering
 * - Local UI state (activeView, testing, validation)
 * - Domain-specific logic (connection testing, JSON parsing)
 * - Calling onChange for content updates
 */
import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Box,
  VStack,
  Input,
  Button,
  Text,
  Heading,
  HStack,
} from '@chakra-ui/react';
import { Checkbox } from '@/components/ui/checkbox';
import { LuTriangleAlert, LuFileJson2, LuEye, LuSave, LuTable, LuSettings, LuArrowLeft, LuCircleAlert, LuCheck } from 'react-icons/lu';
import { ConnectionContent } from '@/lib/types';
import { testConnection } from '@/lib/connections/client/connection-test';
import TabSwitcher from '../selectors/TabSwitcher';
import Editor from '@monaco-editor/react';
import { resolvePath } from '@/lib/mode/path-resolver';
import type { Mode } from '@/lib/mode/mode-types';
import ConnectionTablesBrowser from '../schema-browser/ConnectionTablesBrowser';
import { useContext as useContextHook } from '@/lib/hooks/useContext';
import { BigQueryConfig, PostgreSQLConfig, AthenaConfig, DuckDBConfig, SqliteConfig, ClickHouseConfig } from './connection-configs';
import { cursorBlinkKeyframes } from '@/lib/ui/animations';
import { CONNECTION_TYPES } from '@/lib/ui/connection-type-options';
import ConnectionTypePicker from '@/components/shared/ConnectionTypePicker';

const TYPEWRITER_SPEED = 35;

// Logo/name for types not in the type-selector (legacy connections, static)
const LEGACY_TYPE_INFO: Record<string, { logo: string; name: string }> = {
  'csv':          { logo: '/logos/csv.svg',          name: 'CSV / Sheets' },
  'google-sheets':{ logo: '/logos/google-sheets.svg', name: 'Google Sheets' },
  'duckdb':       { logo: '/logos/duckdb.svg',        name: 'DuckDB' },
  'sqlite':       { logo: '/logos/sqlite.svg',        name: 'SQLite' },
};

function getTypeInfo(type: string): { logo: string; name: string } {
  return (
    CONNECTION_TYPES.find((c) => c.type === type) ??
    LEGACY_TYPE_INFO[type] ??
    { logo: '/logos/duckdb.svg', name: type }
  );
}

interface ConnectionFormV2Props {
  content: ConnectionContent;
  fileName: string;  // File name (connection identifier) - separate from content
  isDirty: boolean;
  isSaving: boolean;
  saveError: string | null;
  onChange: (updates: Partial<ConnectionContent>) => void;
  onFileNameChange: (newName: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onReload?: () => void;  // Optional reload function from container
  mode: 'create' | 'view';
  hideCancel?: boolean;
  greeting?: string;
  /** When true, skip switching to 'tables' view after save (wizard handles navigation). */
  wizardMode?: boolean;
  /** Called when CSV/Sheets is selected in wizard mode instead of navigating away. */
  /** Skip the type selection step and go straight to configure (type already set on content). */
  skipTypeSelection?: boolean;
  colorMode: 'light' | 'dark';
  userMode: Mode;
  showJson: boolean;
  homeFolder: string;
}

export default function ConnectionFormV2({
  content,
  fileName,
  isDirty,
  isSaving,
  saveError,
  onChange,
  onFileNameChange,
  onSave,
  onCancel,
  onReload,
  mode,
  hideCancel = false,
  greeting,
  wizardMode = false,
  skipTypeSelection = false,
  colorMode,
  userMode,
  showJson,
  homeFolder,
}: ConnectionFormV2Props) {
  const router = useRouter();
  const homePath = resolvePath(userMode, homeFolder || '/');
  const { databases: contextDatabases, hasContext } = useContextHook(homePath, undefined, true);
  // Check whitelist status for this specific connection: 'full' | 'partial' | 'none'
  const whitelistedDb = hasContext ? contextDatabases.find(db => db.databaseName === fileName) : undefined;

  // Enriched schema viewer (dev mode only)
  const [schemaJsonExpanded, setSchemaJsonExpanded] = useState(false);



  // For create mode, start with type selection step; skip if already editing or skipTypeSelection set
  const [step, setStep] = useState<'select-type' | 'configure'>(
    mode === 'create' && !skipTypeSelection ? 'select-type' : 'configure'
  );
  // For existing connections, default to 'tables' view; for new connections, show 'settings'.
  // Static connection: defaults to 'tables' unless arriving via ?tab= param (means user
  // clicked CSV/Google Sheets from the type selection and wants to upload).
  const searchParams = useSearchParams();
  const hasTabParam = searchParams.has('tab');
  const [activeSection, setActiveSection] = useState<'tables' | 'settings'>(
    mode === 'view' ? 'tables' : 'settings'
  );
  const [activeView, setActiveView] = useState<'form' | 'json'>('form');
  const [nameError, setNameError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [includeSchema, setIncludeSchema] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    schema?: any;
  } | null>(null);

  // Typewriter effect for greeting
  const [displayedText, setDisplayedText] = useState('');
  const [typingDone, setTypingDone] = useState(!greeting);

  useEffect(() => {
    if (!greeting) return;
    let i = 0;
    setDisplayedText('');
    setTypingDone(false);
    const interval = setInterval(() => {
      i++;
      setDisplayedText(greeting.slice(0, i));
      if (i >= greeting.length) {
        clearInterval(interval);
        setTypingDone(true);
      }
    }, TYPEWRITER_SPEED);
    return () => clearInterval(interval);
  }, [greeting]);

  // Handle type selection from the initial screen
  const handleTypeSelect = (connType: { type: string; isStatic?: boolean; comingSoon: boolean }) => {
    if (connType.comingSoon) return;
    const selectedType = connType.type;

    handleTypeChange(selectedType as 'bigquery' | 'postgresql' | 'csv' | 'google-sheets' | 'athena' | 'clickhouse');
    setStep('configure');
  };

  // Go back to type selection
  const handleBackToTypeSelect = () => {
    setStep('select-type');
  };

  // Get schema directly from content (loaded via container's useFile)
  const schemas = content.schema?.schemas || [];
  const schemaLoading = false; // Container handles loading state
  const schemaError = !content.schema ? 'Schema not available' : null;
  const handleSchemaReload = onReload || (() => {});

  // Extract config fields for easier access
  const config = content.config || {};
  const filePath = config.file_path || '';
  const projectId = config.project_id || '';
  const serviceAccountJson = config.service_account_json || '';

  // Generate JSON representation
  const connectionJson = JSON.stringify({
    name: fileName,
    type: content.type,
    config: (content.type === 'duckdb' || content.type === 'sqlite')
      ? { file_path: filePath }
      : content.type === 'bigquery'
      ? {
          project_id: projectId,
          service_account_json: serviceAccountJson ? '***REDACTED***' : ''
        }
      : content.type === 'postgresql'
      ? (config.connection_string
        ? { connection_string: '***REDACTED***' }
        : {
            host: config.host || 'localhost',
            port: config.port || 5432,
            database: config.database || '',
            username: config.username ? '***REDACTED***' : '',
            password: config.password ? '***REDACTED***' : ''
          })
      : content.type === 'csv'
      ? {
          files: config.files || []
        }
      : content.type === 'google-sheets'
      ? {
          spreadsheet_url: config.spreadsheet_url || '',
          spreadsheet_id: config.spreadsheet_id || '',
          schema_name: config.schema_name || 'public',
          files: config.files || []
        }
      : content.type === 'athena'
      ? {
          region_name: config.region_name || '',
          s3_staging_dir: config.s3_staging_dir || '',
          aws_access_key_id: config.aws_access_key_id ? '***REDACTED***' : '',
          aws_secret_access_key: config.aws_secret_access_key ? '***REDACTED***' : '',
          schema_name: config.schema_name || '',
          work_group: config.work_group || ''
        }
      : content.type === 'clickhouse'
      ? {
          host: config.host || '',
          port: config.port || '',
          protocol: config.protocol || 'https',
          database: config.database || '',
          username: config.username || '',
          password: config.password ? '***REDACTED***' : ''
        }
      : config
  }, null, 2);

  // Real-time validation for connection name
  const validateName = (value: string): boolean => {
    if (!value) {
      setNameError('Connection name is required');
      return false;
    }
    if (!/^[a-z0-9_]+$/.test(value)) {
      setNameError('Only lowercase letters, numbers, and underscores allowed');
      return false;
    }
    setNameError(null);
    return true;
  };

  // Check if form is valid for saving/testing (no side effects)
  const isFormValidForTest = (): boolean => {
    // Name validation (without setting error state)
    if (!fileName || !/^[a-z0-9_]+$/.test(fileName)) {
      return false;
    }

    // Type-specific validation
    if (content.type === 'duckdb' || content.type === 'sqlite') {
      if (!filePath) return false;
    } else if (content.type === 'bigquery') {
      if (!projectId || !serviceAccountJson) return false;
      // Validate JSON format
      try {
        const parsed = JSON.parse(serviceAccountJson);
        const creds = parsed.credentials ?? parsed;
        if (!creds.type || creds.type !== 'service_account') {
          return false;
        }
      } catch {
        return false;
      }
    } else if (content.type === 'postgresql') {
      if (config.connection_string) {
        if (!config.connection_string.trim()) return false;
      } else {
        if (!config.database || !config.username) return false;
      }
    } else if (content.type === 'csv') {
      if (fileName !== 'static' && !config.files?.length) return false;
    } else if (content.type === 'google-sheets') {
      if (!config.files?.length) return false;
    } else if (content.type === 'athena') {
      if (!config.region_name || !config.s3_staging_dir) return false;
    } else if (content.type === 'clickhouse') {
      if (!config.host || !config.username) return false;
    }

    return true;
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
    onFileNameChange(value);
    if (value) {
      validateName(value);
    } else {
      setNameError(null);
    }
  };

  const handleTypeChange = (newType: 'bigquery' | 'postgresql' | 'csv' | 'google-sheets' | 'athena' | 'duckdb' | 'sqlite' | 'clickhouse') => {
    // Clear config when switching types
    const configByType: Record<string, Record<string, any>> = {
      bigquery: { project_id: '', service_account_json: '' },
      csv: { schema_name: 'public', files: [] },
      'google-sheets': { spreadsheet_url: '', spreadsheet_id: '', schema_name: 'public', files: [] },
      duckdb: { file_path: '' },
      sqlite: { file_path: '' },
      clickhouse: { protocol: 'https', host: '', port: 8443, database: '', username: '', password: '' },
    };
    onChange({
      type: newType,
      config: configByType[newType] ?? { host: 'localhost', port: 5432, database: '', username: '', password: '' },
    });
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      if (content.type === 'duckdb' || content.type === 'sqlite') {
        // For DuckDB/SQLite, test the connection (works in both create and view modes)
        const result = await testConnection(
          content.type,
          config,
          mode === 'view' ? fileName : undefined,
          includeSchema
        );
        setTestResult(result);
      } else if (content.type === 'bigquery') {
        if (!serviceAccountJson && mode === 'create') {
          setTestResult({
            success: false,
            message: 'Service account JSON is required to test',
          });
          setTesting(false);
          return;
        }

        // For view mode, test the existing connection
        if (mode === 'view') {
          const result = await testConnection(content.type, config, fileName, includeSchema);
          setTestResult(result);
        } else {
          // For create mode, validate credentials by temporarily testing the connection
          try {
            const parsed = JSON.parse(serviceAccountJson);
            const creds = parsed.credentials ?? parsed;
            if (!creds.type || creds.type !== 'service_account') {
              setTestResult({
                success: false,
                message: 'Invalid service account JSON format',
              });
              setTesting(false);
              return;
            }

            // Validate name first
            if (!validateName(fileName)) {
              setTestResult({
                success: false,
                message: 'Please enter a valid connection name first',
              });
              setTesting(false);
              return;
            }

            // Actually test the connection using the unified endpoint
            const result = await testConnection(content.type, config, undefined, includeSchema);
            setTestResult(result);
          } catch (e) {
            setTestResult({
              success: false,
              message: 'Invalid JSON format',
            });
          }
        }
      } else if (content.type === 'postgresql') {
        // For PostgreSQL, test the connection
        if (!config.database || !config.username) {
          setTestResult({
            success: false,
            message: 'Database and username are required to test',
          });
          setTesting(false);
          return;
        }

        if (mode === 'view') {
          const result = await testConnection(content.type, config, fileName, includeSchema);
          setTestResult(result);
        } else {
          // For create mode, validate name first
          if (!validateName(fileName)) {
            setTestResult({
              success: false,
              message: 'Please enter a valid connection name first',
            });
            setTesting(false);
            return;
          }

          // Test the connection using the unified endpoint
          const result = await testConnection(content.type, config, undefined, includeSchema);
          setTestResult(result);
        }
      } else if (content.type === 'csv') {
        // For CSV, test the S3-backed connection
        if (!config.files?.length) {
          setTestResult({
            success: false,
            message: mode === 'create'
              ? 'Please upload CSV files first, then save the connection'
              : 'No files registered. Please re-upload CSV files.',
          });
          setTesting(false);
          return;
        }

        // Test the connection (uses in-memory DuckDB + httpfs)
        const result = await testConnection(content.type, config, mode === 'view' ? fileName : undefined, includeSchema);
        setTestResult(result);
      } else if (content.type === 'google-sheets') {
        // For Google Sheets, test the S3-backed connection
        if (!config.files?.length) {
          setTestResult({
            success: false,
            message: mode === 'create'
              ? 'Please import a Google Sheet first using the "Fetch & Create Database" button'
              : 'No sheets imported. Please re-import the Google Sheet.',
          });
          setTesting(false);
          return;
        }

        // Test the connection (uses in-memory DuckDB + httpfs via CsvConnector)
        const result = await testConnection(content.type, config, mode === 'view' ? fileName : undefined, includeSchema);
        setTestResult(result);
      } else {
        // Generic handler for all other connection types (e.g. Athena)
        if (mode === 'view') {
          const result = await testConnection(content.type, config, fileName, includeSchema);
          setTestResult(result);
        } else {
          if (!validateName(fileName)) {
            setTestResult({
              success: false,
              message: 'Please enter a valid connection name first',
            });
            setTesting(false);
            return;
          }
          const result = await testConnection(content.type, config, undefined, includeSchema);
          setTestResult(result);
        }
      }
    } catch (e) {
      setTestResult({
        success: false,
        message: e instanceof Error ? e.message : 'Connection test failed',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSaveClick = async () => {
    // Validation before save
    if (!validateName(fileName)) {
      return;
    }

    if (content.type === 'duckdb' || content.type === 'sqlite') {
      if (!filePath) {
        setNameError('Database file path is required');
        return;
      }
    } else if (content.type === 'bigquery') {
      if (!projectId) {
        setNameError('Project ID is required (extracted from service account JSON)');
        return;
      }
      if (!serviceAccountJson) {
        setNameError('Service account JSON is required');
        return;
      }

      // Validate JSON format
      try {
        const parsed = JSON.parse(serviceAccountJson);
        const creds = parsed.credentials ?? parsed;
        if (!creds.type || creds.type !== 'service_account') {
          setNameError('Invalid service account JSON: must be a service account key');
          return;
        }
        if (!creds.project_id) {
          setNameError('Invalid service account JSON: missing project_id');
          return;
        }
      } catch (e) {
        setNameError('Invalid JSON format');
        return;
      }
    } else if (content.type === 'postgresql') {
      if (config.connection_string) {
        if (!config.connection_string.trim()) {
          setNameError('Connection string is required');
          return;
        }
      } else {
        if (!config.database) {
          setNameError('Database name is required');
          return;
        }
        if (!config.username) {
          setNameError('Username is required');
          return;
        }
      }
    } else if (content.type === 'csv' && fileName !== 'static') {
      // For non-static CSV connections, validate that files have been uploaded
      if (!config.files?.length) {
        setNameError('Please upload CSV files first using the "Upload & Register" button');
        return;
      }
    } else if (content.type === 'google-sheets') {
      // For Google Sheets, validate that sheets have been imported
      if (!config.files?.length) {
        setNameError('Please import a Google Sheet first using the "Fetch & Create Database" button');
        return;
      }
    }

    onSave();
    if (!wizardMode) {
      setActiveSection('tables');
    }
  };

  // Type Selection Screen (Step 1 for create mode)
  if (mode === 'create' && step === 'select-type') {
    return (
      <Box p={6} overflowY="auto">
        <VStack align="stretch" gap={8} pb={4}>
          {/* Keyframes */}
          <style>{cursorBlinkKeyframes}</style>

          {/* Header with optional typewriter */}
          <VStack align="start" gap={2}>
            {greeting ? (
              <Heading
                fontSize="2xl"
                fontFamily="mono"
                fontWeight="400"
                letterSpacing="-0.02em"
                lineHeight="1.4"
              >
                {displayedText}
                {!typingDone && (
                  <Box
                    as="span"
                    display="inline-block"
                    w="2px"
                    h="1em"
                    bg="accent.teal"
                    ml="2px"
                    verticalAlign="text-bottom"
                    css={{ animation: 'cursorBlink 0.8s step-end infinite' }}
                  />
                )}
              </Heading>
            ) : (
              <>
                <Heading fontSize="2xl" fontWeight="900" letterSpacing="-0.02em">
                  Add Dataset
                </Heading>
                <Text color="fg.muted" fontSize="sm">
                  Select a database type to connect to
                </Text>
              </>
            )}
          </VStack>


          <ConnectionTypePicker onSelect={handleTypeSelect} />
        </VStack>
      </Box>
    );
  }

  return (
    <Box p={6} overflowY="auto">
      <VStack align="stretch" gap={6} pb={4}>
        {/* Header with Save Button */}
        <HStack justify="space-between" align="center">
          <HStack gap={3} align="center">
            {/* Back button in create mode */}
            {mode === 'create' && (
              <Button
                onClick={handleBackToTypeSelect}
                variant="ghost"
                size="sm"
                px={2}
                minW="auto"
              >
                <LuArrowLeft size={18} />
              </Button>
            )}
            <Heading fontSize="2xl" fontWeight="900" letterSpacing="-0.02em">
              {mode === 'create' ? 'Add Dataset' : fileName}
            </Heading>
            {mode === 'view' && (
              <Box
                display="inline-flex"
                px={2}
                py={1}
                bg="accent.primary"
                color="white"
                fontWeight={700}
                borderRadius="full"
                fontFamily="mono"
                fontSize="2xs"
                alignItems="center"
              >
                {getTypeInfo(content.type).name}
              </Box>
            )}
            {/* Unsaved changes warning — hide in create mode (everything is unsaved) */}
            {isDirty && mode === 'view' && (
              <HStack
                gap={1.5}
                px={2}
                py={1}
                bg="accent.warning/15"
                borderRadius="md"
                border="1px solid"
                borderColor="accent.warning/30"
              >
                <LuCircleAlert size={14} color="var(--chakra-colors-accent-warning)" />
                <Text fontSize="xs" color="accent.warning" fontWeight="600">
                  Unsaved
                </Text>
              </HStack>
            )}
          </HStack>

          <HStack gap={2}>
            {/* Section Toggle for existing connections — DuckDB is system-managed, no settings */}
            {mode === 'view' && content.type !== 'duckdb' && (
              <HStack
                gap={0}
                bg="bg.surface"
                borderRadius="lg"
                p={1}
                border="1px solid"
                borderColor="border.default"
              >
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Tables view"
                  onClick={() => setActiveSection('tables')}
                  bg={activeSection === 'tables' ? 'accent.teal' : 'transparent'}
                  color={activeSection === 'tables' ? 'white' : 'fg.muted'}
                  _hover={{ bg: activeSection === 'tables' ? 'accent.teal' : 'bg.muted' }}
                  borderRadius="md"
                  fontSize="xs"
                  fontWeight="600"
                  px={3}
                >
                  <LuTable />
                  Table View
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Settings view"
                  onClick={() => setActiveSection('settings')}
                  bg={activeSection === 'settings' ? 'accent.teal' : 'transparent'}
                  color={activeSection === 'settings' ? 'white' : 'fg.muted'}
                  _hover={{ bg: activeSection === 'settings' ? 'accent.teal' : 'bg.muted' }}
                  borderRadius="md"
                  fontSize="xs"
                  fontWeight="600"
                  px={3}
                >
                  <LuSettings />
                  Settings
                </Button>
              </HStack>
            )}
          </HStack>
        </HStack>

        {/* View Toggle - only show in settings section when showJson is enabled */}
        {activeSection === 'settings' && showJson && (
          <HStack justify="flex-end">
            <TabSwitcher
              tabs={[
                { value: 'form', label: 'Form View', icon: LuEye },
                { value: 'json', label: 'JSON View', icon: LuFileJson2 }
              ]}
              activeTab={activeView}
              onTabChange={(tab) => setActiveView(tab as 'form' | 'json')}
              accentColor="accent.muted"
            />
          </HStack>
        )}

        {/* Tables Browser - shown by default for existing connections */}
        {activeSection === 'tables' && (<>
          <HStack align="start" gap={6} flex="1">
            {/* Left: Tables */}
            <VStack align="stretch" gap={4} flex="1" minW={0}>
              {/* System-managed notice for DuckDB connections */}
              {content.type === 'duckdb' && (
                <HStack
                  gap={2}
                  px={4}
                  py={3}
                  bg="bg.muted"
                  borderRadius="md"
                  border="1px solid"
                  borderColor="border.subtle"
                >
                  <Text fontSize="sm" color="fg.muted">
                    This is a system-managed, read-only connection. Its configuration cannot be changed.
                  </Text>
                </HStack>
              )}
              <Box minH="400px">
                <ConnectionTablesBrowser
                  schemas={schemas}
                  schemaLoading={schemaLoading}
                  schemaError={schemaError}
                  connectionName={fileName}
                  onRetry={handleSchemaReload}
                />
              </Box>
            </VStack>

          </HStack>

          {/* Enriched Schema JSON (dev mode only) */}
          {showJson && schemas.length > 0 && (
            <Box mt={4}>
              <Text
                fontSize="2xs"
                fontFamily="mono"
                color="fg.muted"
                cursor="pointer"
                onClick={() => setSchemaJsonExpanded(!schemaJsonExpanded)}
              >
                {schemaJsonExpanded ? '▾' : '▸'} Enriched Schema ({schemas.reduce((sum, s) => sum + s.tables.length, 0)} tables)
                {content.schema?.updated_at && ` · ${new Date(content.schema.updated_at).toLocaleString()}`}
              </Text>
              {schemaJsonExpanded && (
                <Box mt={2} borderRadius="md" overflow="hidden" border="1px solid" borderColor="border.default">
                  <Editor
                    height="500px"
                    language="json"
                    value={JSON.stringify(schemas, null, 2)}
                    theme={colorMode === 'dark' ? 'vs-dark' : 'light'}
                    options={{
                      readOnly: true,
                      minimap: { enabled: false },
                      folding: true,
                      lineNumbers: 'off',
                      fontSize: 12,
                      fontFamily: 'var(--font-jetbrains-mono)',
                      scrollBeyondLastLine: false,
                      wordWrap: 'on',
                    }}
                  />
                </Box>
              )}
            </Box>
          )}
        </>)}


        {/* Settings Section */}
        {activeSection === 'settings' && (
          <>
            {(saveError || nameError) && (
              <Box
                p={3}
                bg="accent.danger"
                color="white"
                borderRadius="md"
                fontSize="sm"
              >
                {saveError || nameError}
              </Box>
            )}

            {/* Form View */}
            {activeView === 'form' && (
        <>
        {/* Connection Name */}
        <Box>
          <Text fontSize="sm" fontWeight="700" mb={2}>
            Connection Name
          </Text>
          <Input
            value={fileName}
            onChange={handleNameChange}
            placeholder="analytics_prod"
            disabled={mode === 'view'}
            fontFamily="mono"
            borderColor={nameError ? 'accent.danger' : undefined}
          />
          {nameError ? (
            <HStack gap={1} mt={1}>
              <LuTriangleAlert size={12} color="var(--chakra-colors-accent-danger)" />
              <Text fontSize="xs" color="accent.danger">
                {nameError}
              </Text>
            </HStack>
          ) : (
            <Text fontSize="xs" color="fg.muted" mt={1}>
              Lowercase letters, numbers, and underscores only
            </Text>
          )}
        </Box>

        {/* BigQuery Configuration */}
        {content.type === 'bigquery' && (
          <BigQueryConfig
            config={config}
            onChange={(newConfig) => onChange({ config: newConfig })}
            mode={mode}
          />
        )}

        {/* PostgreSQL Configuration */}
        {content.type === 'postgresql' && (
          <PostgreSQLConfig
            config={config}
            onChange={(newConfig) => onChange({ config: newConfig })}
            mode={mode}
          />
        )}

        {/* Athena Configuration */}
        {content.type === 'athena' && (
          <AthenaConfig
            config={config}
            onChange={(newConfig) => onChange({ config: newConfig })}
            mode={mode}
          />
        )}

        {/* ClickHouse Configuration */}
        {content.type === 'clickhouse' && (
          <ClickHouseConfig
            config={config}
            onChange={(newConfig) => onChange({ config: newConfig })}
            mode={mode}
          />
        )}

        {/* DuckDB Configuration */}
        {content.type === 'duckdb' && (
          <DuckDBConfig
            config={config}
            onChange={(newConfig) => onChange({ config: newConfig })}
            mode={mode}
          />
        )}

        {/* SQLite Configuration */}
        {content.type === 'sqlite' && (
          <SqliteConfig
            config={config}
            onChange={(newConfig) => onChange({ config: newConfig })}
            mode={mode}
          />
        )}

        {/* Actions */}
        <HStack gap={3} pt={2} justify="flex-end">
          {showJson && (
            <Checkbox
              checked={includeSchema}
              onCheckedChange={(e) => setIncludeSchema(e.checked === true)}
              size="sm"
            >
              <Text fontSize="xs" color="fg.muted">
                Include schema
              </Text>
            </Checkbox>
          )}
          {testResult && (
            <HStack
              gap={1.5}
              px={2.5}
              py={1}
              bg={testResult.success ? 'accent.teal/10' : 'accent.danger/10'}
              borderRadius="full"
              border="1px solid"
              borderColor={testResult.success ? 'accent.teal/30' : 'accent.danger/30'}
            >
              {testResult.success ? (
                <LuCheck size={12} color="var(--chakra-colors-accent-teal)" />
              ) : (
                <LuCircleAlert size={12} color="var(--chakra-colors-accent-danger)" />
              )}
              <Text
                fontSize="xs"
                color={testResult.success ? 'accent.teal' : 'accent.danger'}
                fontWeight="600"
              >
                {testResult.message}
              </Text>
            </HStack>
          )}
          <Button
            onClick={handleTest}
            loading={testing}
            disabled={!isFormValidForTest()}
            size="sm"
            variant="outline"
          >
            Test Connection
          </Button>
          <Button
            onClick={handleSaveClick}
            loading={isSaving}
            loadingText="Saving connection..."
            disabled={!isDirty || !isFormValidForTest()}
            size="sm"
            bg="accent.teal"
            color="white"
            aria-label="Save connection"
          >
            <LuSave />
            {wizardMode ? 'Save & Continue' : 'Save Connection'}
          </Button>
        </HStack>

        {/* Schema Display */}
        {testResult?.success && testResult.schema && testResult.schema.length > 0 && (
          <Box
            borderWidth="1px"
            borderColor="border.subtle"
            borderRadius="md"
            p={4}
            bg="bg.muted"
            maxH="400px"
            overflowY="auto"
          >
            <Text fontSize="sm" fontWeight="600" mb={3}>
              Available Schemas & Tables
            </Text>
            <VStack align="stretch" gap={3}>
              {testResult.schema.map((schema: any, schemaIdx: number) => (
                <Box key={schemaIdx}>
                  <Text fontSize="xs" fontWeight="700" color="accent.emphasized" mb={2}>
                    {schema.schema}
                  </Text>
                  <VStack align="stretch" gap={2} pl={3}>
                    {schema.tables.map((table: any, tableIdx: number) => (
                      <Box key={tableIdx}>
                        <Text fontSize="xs" fontWeight="600" fontFamily="mono">
                          {table.table}
                        </Text>
                        <Text fontSize="xs" color="fg.muted" fontFamily="mono" pl={3}>
                          {table.columns.map((col: any) => col.name).join(', ')}
                        </Text>
                      </Box>
                    ))}
                  </VStack>
                </Box>
              ))}
            </VStack>
          </Box>
        )}
            </>
            )}

            {/* JSON View */}
            {activeView === 'json' && (
              <Box>
                <Text fontSize="sm" color="fg.muted" mb={3}>
                  Read-only JSON representation of the connection configuration
                </Text>
                <Box
                  borderRadius="md"
                  overflow="hidden"
                  borderWidth="1px"
                  borderColor="border.default"
                >
                  <Editor
                    height="400px"
                    language="json"
                    theme={colorMode === 'dark' ? 'vs-dark' : 'light'}
                    value={connectionJson}
                    options={{
                      readOnly: true,
                      minimap: { enabled: false },
                      fontSize: 13,
                      fontFamily: 'var(--font-jetbrains-mono)',
                      lineNumbers: 'on',
                      scrollBeyondLastLine: false,
                      wordWrap: 'on',
                    }}
                  />
                </Box>
              </Box>
            )}
          </>
        )}
      </VStack>
    </Box>
  );
}
