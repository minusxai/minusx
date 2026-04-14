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
import Link from 'next/link';
import {
  Box,
  VStack,
  Input,
  Button,
  Text,
  Heading,
  HStack,
  Menu,
  Portal,
  Icon,
  SimpleGrid,
} from '@chakra-ui/react';
import { Checkbox } from '@/components/ui/checkbox';
import { LuTriangleAlert, LuFileJson2, LuEye, LuSave, LuChevronDown, LuTable, LuSettings, LuArrowLeft, LuCircleAlert } from 'react-icons/lu';
import { ConnectionContent } from '@/lib/types';
import { testConnection } from '@/lib/backend/python-backend';
import TabSwitcher from '../TabSwitcher';
import Editor from '@monaco-editor/react';
import { useAppSelector } from '@/store/hooks';
import ConnectionTablesBrowser from '../ConnectionTablesBrowser';
import Image from 'next/image';
import { BigQueryConfig, PostgreSQLConfig, CsvConfig, GoogleSheetsConfig, AthenaConfig } from './connection-configs';
import { cursorBlinkKeyframes } from '@/lib/ui/animations';

const TYPEWRITER_SPEED = 35;

// Connection type metadata for the selection screen
const CONNECTION_TYPES = [
  {
    type: 'bigquery' as const,
    name: 'BigQuery',
    logo: '/logos/bigquery.svg',
    comingSoon: false,
  },
  {
    type: 'postgresql' as const,
    name: 'PostgreSQL',
    logo: '/logos/postgresql.svg',
    comingSoon: false,
  },
  {
    type: 'csv' as const,
    name: 'CSV Files',
    logo: '/logos/csv.svg',
    comingSoon: false,
  },
  {
    type: 'google-sheets' as const,
    name: 'Google Sheets',
    logo: '/logos/google-sheets.svg',
    comingSoon: false,
    note: 'Public sheets only',
  },
  {
    type: 'athena' as const,
    name: 'Athena',
    logo: '/logos/athena.svg',
    comingSoon: false,
  },
  {
    type: 'clickhouse' as const,
    name: 'ClickHouse',
    logo: '/logos/clickhouse.svg',
    comingSoon: true,
  },
  {
    type: 'databricks' as const,
    name: 'Databricks',
    logo: '/logos/databricks.svg',
    comingSoon: true,
  },
  {
    type: 'snowflake' as const,
    name: 'Snowflake',
    logo: '/logos/snowflake.svg',
    comingSoon: true,
  }
];

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
}: ConnectionFormV2Props) {
  const colorMode = useAppSelector((state) => state.ui.colorMode);
  const companyId = useAppSelector((state) => state.auth.user?.companyId);
  const userMode = useAppSelector((state) => state.auth.user?.mode) || 'org';
  const showJson = useAppSelector((state) => state.ui.showJson);

  // For create mode, start with type selection step; skip if already editing
  const [step, setStep] = useState<'select-type' | 'configure'>(mode === 'create' ? 'select-type' : 'configure');
  // For existing connections, default to 'tables' view; for new connections, show 'settings'
  const [activeSection, setActiveSection] = useState<'tables' | 'settings'>(mode === 'view' ? 'tables' : 'settings');
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
  const handleTypeSelect = (selectedType: 'bigquery' | 'postgresql' | 'csv' | 'google-sheets' | 'athena') => {
    handleTypeChange(selectedType);
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
    config: content.type === 'duckdb'
      ? { file_path: filePath }
      : content.type === 'bigquery'
      ? {
          project_id: projectId,
          service_account_json: serviceAccountJson ? '***REDACTED***' : ''
        }
      : content.type === 'postgresql'
      ? {
          host: config.host || 'localhost',
          port: config.port || 5432,
          database: config.database || '',
          username: config.username ? '***REDACTED***' : '',
          password: config.password ? '***REDACTED***' : ''
        }
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
    if (content.type === 'duckdb') {
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
      if (!config.database || !config.username) return false;
    } else if (content.type === 'csv') {
      if (!config.files?.length) return false;
    } else if (content.type === 'google-sheets') {
      if (!config.files?.length) return false;
    } else if (content.type === 'athena') {
      if (!config.region_name || !config.s3_staging_dir) return false;
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

  const handleTypeChange = (newType: 'bigquery' | 'postgresql' | 'csv' | 'google-sheets' | 'athena') => {
    // Clear config when switching types
    onChange({
      type: newType,
      config: newType === 'bigquery'
        ? { project_id: '', service_account_json: '' }
        : newType === 'csv'
        ? { schema_name: 'public', files: [] }
        : newType === 'google-sheets'
        ? { spreadsheet_url: '', spreadsheet_id: '', schema_name: 'public', files: [] }
        : { host: 'localhost', port: 5432, database: '', username: '', password: '' }
    });
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      if (content.type === 'duckdb') {
        // For DuckDB, test the connection (works in both create and view modes)
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

    if (content.type === 'duckdb') {
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
      if (!config.database) {
        setNameError('Database name is required');
        return;
      }
      if (!config.username) {
        setNameError('Username is required');
        return;
      }
    } else if (content.type === 'csv') {
      // For CSV, validate that files have been uploaded (files array must have entries)
      if (!config.files?.length) {
        setNameError('Please upload CSV files first using the "Upload & Create Database" button');
        return;
      }
    } else if (content.type === 'google-sheets') {
      // For Google Sheets, validate that sheets have been imported (files array must have entries)
      if (!config.files?.length) {
        setNameError('Please import a Google Sheet first using the "Fetch & Create Database" button');
        return;
      }
    }

    onSave();
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
                  Add Connection
                </Heading>
                <Text color="fg.muted" fontSize="sm">
                  Select a database type to connect to
                </Text>
              </>
            )}
          </VStack>

          {/* Connection Type Cards */}
          <SimpleGrid columns={{ base: 1, md: 4 }} gap={4}>
            {CONNECTION_TYPES.map((connType) => (
              <Box
                key={connType.type}
                as="button"
                onClick={() => !connType.comingSoon && handleTypeSelect(connType.type as 'bigquery' | 'postgresql' | 'csv' | 'google-sheets' | 'athena')}
                p={6}
                borderRadius="lg"
                border="1px solid"
                borderColor="border.default"
                bg="bg.surface"
                cursor={connType.comingSoon ? 'not-allowed' : 'pointer'}
                textAlign="left"
                transition="all 0.2s"
                position="relative"
                _hover={connType.comingSoon ? {} : {
                  borderColor: 'accent.teal',
                  bg: 'bg.muted',
                  transform: 'translateY(-2px)',
                  shadow: 'md',
                }}
              >
                {/* Coming Soon Badge */}
                {connType.comingSoon && (
                  <Box
                    position="absolute"
                    top={2}
                    right={2}
                    px={2}
                    py={0.5}
                    bg="accent.teal"
                    color="white"
                    fontSize="2xs"
                    fontWeight="700"
                    borderRadius="full"
                  >
                    Coming Soon
                  </Box>
                )}
                <VStack align="center" gap={4}>
                  {/* Logo */}
                  <Box
                    w="64px"
                    h="64px"
                    position="relative"
                    borderRadius="md"
                    overflow="hidden"
                    opacity={connType.comingSoon ? 0.5 : 1}
                    p={2}
                    filter={connType.comingSoon ? 'grayscale(10%)' : 'none'}
                  >
                    <Image
                      src={connType.logo}
                      alt={connType.name}
                      fill
                      style={{ objectFit: 'contain', padding: '4px' }}
                    />
                  </Box>

                  {/* Name & Note */}
                  <VStack align="center" gap={0}>
                    <Text fontWeight="700" fontSize="md" fontFamily={"mono"}
                    color={connType.comingSoon ? 'fg.subtle' : 'fg.default'}>
                      {connType.name}
                    </Text>
                    {'note' in connType && connType.note && (
                      <Text fontSize="2xs" color="fg.muted" fontStyle="italic">
                        {connType.note}
                      </Text>
                    )}
                  </VStack>
                </VStack>
              </Box>
            ))}
          </SimpleGrid>

          {/* Cancel Button */}
          {!hideCancel && (
            <HStack>
              <Button onClick={onCancel} variant="ghost" size="sm">
                Cancel
              </Button>
            </HStack>
          )}
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
                p={0}
                minW="auto"
              >
                <Icon as={LuArrowLeft} boxSize={5} />
              </Button>
            )}
            <Heading fontSize="2xl" fontWeight="900" letterSpacing="-0.02em">
              {mode === 'create' ? 'Add Connection' : fileName}
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
                {content.type === 'bigquery' ? 'BigQuery' :
                 content.type === 'duckdb' ? 'DuckDB' :
                 content.type === 'postgresql' ? 'PostgreSQL' :
                 content.type === 'csv' ? 'CSV Files' :
                 content.type === 'google-sheets' ? 'Google Sheets' :
                 content.type === 'athena' ? 'Athena' :
                 content.type}
              </Box>
            )}
            {/* Unsaved changes warning */}
            {isDirty && (
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
            {/* Section Toggle for existing connections */}
            {mode === 'view' && (
              <TabSwitcher
                tabs={[
                  { value: 'tables', label: 'Tables', icon: LuTable },
                  { value: 'settings', label: 'Settings', icon: LuSettings }
                ]}
                activeTab={activeSection}
                onTabChange={(tab) => setActiveSection(tab as 'tables' | 'settings')}
                accentColor="accent.teal"
              />
            )}
            {activeSection === 'settings' && !hideCancel && (
                <Button onClick={onCancel} variant="ghost" size="xs">
                  Cancel
                </Button>
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
        {activeSection === 'tables' && (
          <VStack align="stretch" gap={4} flex="1">
            {/* Hint message */}
            <HStack
              gap={2}
              px={4}
              py={3}
              bg="accent.teal/10"
              borderRadius="md"
              border="1px solid"
              borderColor="accent.teal/30"
              justify="space-between"
              flexWrap="wrap"
            >
              <Text fontSize="sm" color="fg.muted">
                Click on any table to preview data, or{' '}
                <Link
                  href={`/new/question?databaseName=${encodeURIComponent(fileName)}`}
                  style={{ color: 'var(--chakra-colors-accent-teal)', fontWeight: 600, textDecoration: 'underline' }}
                >
                  create a new question
                </Link>
              </Text>
            </HStack>
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
        )}

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
        {/* Connection Name & Database Type - Side by Side */}
        <HStack align="start" gap={4}>
          {/* Connection Name */}
          <Box flex={1}>
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

          {/* Database Type */}
          <Box flex={1}>
            <Text fontSize="sm" fontWeight="700" mb={2}>
              Database Type
            </Text>
            {mode === 'view' ? (
              <>
                <HStack
                  display="inline-flex"
                  px={3}
                  py={1.5}
                  bg="accent.primary"
                  color="white"
                  fontWeight={700}
                  borderRadius="full"
                  fontFamily="mono"
                  fontSize="xs"
                  alignItems="center"
                  gap={2}
                >
                  <Box w="16px" h="16px" position="relative" flexShrink={0}>
                    <Image
                      src={CONNECTION_TYPES.find(c => c.type === content.type)?.logo || '/logos/duckdb.svg'}
                      alt={content.type}
                      fill
                      style={{ objectFit: 'contain' }}
                    />
                  </Box>
                  {CONNECTION_TYPES.find(c => c.type === content.type)?.name || content.type}
                </HStack>
                <Text fontSize="xs" color="fg.muted" mt={2}>
                  Database type cannot be changed after creation
                </Text>
              </>
            ) : (
              <Menu.Root>
                <Menu.Trigger asChild>
                  <Box
                    px={3}
                    py={2}
                    borderRadius="md"
                    border="1px solid"
                    borderColor="border.default"
                    bg="bg.surface"
                    cursor="pointer"
                    _hover={{ bg: 'bg.muted', borderColor: 'accent.teal' }}
                    transition="all 0.2s"
                  >
                    <HStack gap={2} justify="space-between">
                      <HStack gap={2}>
                        <Box w="20px" h="20px" position="relative" flexShrink={0}>
                          <Image
                            src={CONNECTION_TYPES.find(c => c.type === content.type)?.logo || '/logos/duckdb.svg'}
                            alt={content.type}
                            fill
                            style={{ objectFit: 'contain' }}
                          />
                        </Box>
                        <Text fontSize="sm" fontWeight="500" fontFamily="mono">
                          {CONNECTION_TYPES.find(c => c.type === content.type)?.name || content.type}
                        </Text>
                      </HStack>
                      <Icon as={LuChevronDown} boxSize={4} color="fg.subtle" />
                    </HStack>
                  </Box>
                </Menu.Trigger>
                <Portal>
                  <Menu.Positioner>
                    <Menu.Content
                      minW="240px"
                      bg="bg.surface"
                      borderColor="border.default"
                      shadow="lg"
                      p={1}
                    >
                      {CONNECTION_TYPES.filter(c => !c.comingSoon).map((connType) => (
                        <Menu.Item
                          key={connType.type}
                          value={connType.type}
                          cursor="pointer"
                          borderRadius="sm"
                          px={3}
                          py={2}
                          bg={content.type === connType.type ? 'accent.teal/10' : 'transparent'}
                          _hover={{ bg: content.type === connType.type ? 'accent.teal/20' : 'bg.muted' }}
                          onClick={() => handleTypeChange(connType.type as 'bigquery' | 'postgresql' | 'csv' | 'google-sheets' | 'athena')}
                        >
                          <HStack gap={2}>
                            <Box w="20px" h="20px" position="relative" flexShrink={0}>
                              <Image
                                src={connType.logo}
                                alt={connType.name}
                                fill
                                style={{ objectFit: 'contain' }}
                              />
                            </Box>
                            <Text fontWeight={content.type === connType.type ? '600' : '400'} fontFamily="mono">
                              {connType.name}
                            </Text>
                          </HStack>
                        </Menu.Item>
                      ))}
                    </Menu.Content>
                  </Menu.Positioner>
                </Portal>
              </Menu.Root>
            )}
          </Box>
        </HStack>

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

        {/* CSV Configuration */}
        {content.type === 'csv' && (
          <CsvConfig
            config={config}
            onChange={(newConfig) => onChange({ config: newConfig })}
            mode={mode}
            connectionName={fileName}
            onError={setNameError}
          />
        )}

        {/* Google Sheets Configuration */}
        {content.type === 'google-sheets' && (
          <GoogleSheetsConfig
            config={config}
            onChange={(newConfig) => onChange({ config: newConfig })}
            mode={mode}
            connectionName={fileName}
            companyId={companyId}
            userMode={userMode}
            onError={setNameError}
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

        {/* Test Connection */}
        <VStack align="stretch" gap={3}>
          <HStack gap={2} align="center">
            <Button
              onClick={handleTest}
              loading={testing}
              disabled={!isFormValidForTest()}
              colorPalette="red"
              size="sm"
              variant="outline"
            >
              Test Connection
            </Button>
            <Checkbox
              checked={includeSchema}
              onCheckedChange={(e) => setIncludeSchema(e.checked === true)}
              size="sm"
            >
              <Text fontSize="xs" color="fg.muted">
                Include schema (slower)
              </Text>
            </Checkbox>
            {testResult && (
              <Text
                fontSize="xs"
                color={testResult.success ? 'accent.teal' : 'accent.danger'}
                fontWeight="600"
              >
                {testResult.message}
              </Text>
            )}
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
            </VStack>

        {/* Save Button */}
        <HStack gap={2}>
          <Button
            onClick={handleSaveClick}
            loading={isSaving}
            disabled={!isDirty}
            size="sm"
            bg="accent.teal"
            color="white"
          >
            <LuSave />
            Save DB Connection
          </Button>
        </HStack>
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
