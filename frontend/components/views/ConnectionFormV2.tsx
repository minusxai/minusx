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
import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Box,
  VStack,
  Input,
  Button,
  Text,
  Heading,
  HStack,
  Progress,
  SimpleGrid,
  Switch,
  Textarea,
} from '@chakra-ui/react';
import { Checkbox } from '@/components/ui/checkbox';
import { LuTriangleAlert, LuFileJson2, LuEye, LuSave, LuTable, LuSettings, LuArrowLeft, LuCircleAlert, LuCheck, LuBookOpen, LuPlus, LuLayoutDashboard, LuCompass, LuExternalLink } from 'react-icons/lu';
import { ConnectionContent, ContextContent, DatabaseContext } from '@/lib/types';
import { testConnection } from '@/lib/backend/python-backend';
import TabSwitcher from '../TabSwitcher';
import Editor from '@monaco-editor/react';
import { useAppSelector } from '@/store/hooks';
import { resolvePath } from '@/lib/mode/path-resolver';
import { useFileByPath, useFile } from '@/lib/hooks/file-state-hooks';
import { editFile, publishFile } from '@/lib/api/file-state';
import { convertDatabaseContextToWhitelist } from '@/lib/context/context-utils';
import { getPublishedVersion } from '@/lib/context/context-utils';
import ConnectionTablesBrowser from '../ConnectionTablesBrowser';
import StaticTablesBrowser from '../StaticTablesBrowser';
import { useContext as useContextHook } from '@/lib/hooks/useContext';
import Image from 'next/image';
import { BigQueryConfig, PostgreSQLConfig, CsvConfig, GoogleSheetsConfig, AthenaConfig, StaticConnectionConfig } from './connection-configs';
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
    name: 'CSV / xlsx',
    logo: '/logos/csv.svg',
    comingSoon: false,
    redirectToStatic: true,
    note: 'Managed in your static connection',
  },
  {
    type: 'google-sheets' as const,
    name: 'Google Sheets',
    logo: '/logos/google-sheets.svg',
    comingSoon: false,
    redirectToStatic: true,
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

// Logo/name for types not in the type-selector (legacy connections, static)
const LEGACY_TYPE_INFO: Record<string, { logo: string; name: string }> = {
  'csv':          { logo: '/logos/csv.svg',          name: 'CSV / Sheets' },
  'google-sheets':{ logo: '/logos/google-sheets.svg', name: 'Google Sheets' },
  'duckdb':       { logo: '/logos/duckdb.svg',        name: 'DuckDB' },
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
  onPendingDeletion?: (s3Key: string) => void;
  /** When true, skip switching to 'tables' view after save (wizard handles navigation). */
  wizardMode?: boolean;
  /** Called when CSV/Sheets is selected in wizard mode instead of navigating away. */
  onStaticSelect?: (tab: 'csv' | 'sheets') => void;
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
  onPendingDeletion,
  wizardMode = false,
  onStaticSelect,
}: ConnectionFormV2Props) {
  const router = useRouter();
  const colorMode = useAppSelector((state) => state.ui.colorMode);
  const userMode = useAppSelector((state) => state.auth.user?.mode) || 'org';
  const showJson = useAppSelector((state) => state.ui.devMode);
  const staticConnectionPath = resolvePath(userMode, '/database/static');
  const { file: staticConnectionFile, loading: staticConnectionLoading } = useFileByPath(staticConnectionPath);
  const homeFolder = useAppSelector((state) => state.auth.user?.home_folder) || '';
  const homePath = resolvePath(userMode, homeFolder || '/');
  const { databases: contextDatabases, documentation: contextDocs, hasContext, contextId } = useContextHook(homePath, undefined, true);
  // Check whitelist status for this specific connection: 'full' | 'partial' | 'none'
  const whitelistedDb = hasContext ? contextDatabases.find(db => db.databaseName === fileName) : undefined;
  const whitelistStatus: 'full' | 'partial' | 'none' = (() => {
    if (!whitelistedDb) return 'none';
    // Count total tables in the connection's full schema
    const totalTables = (content.schema?.schemas || []).reduce((sum, s) => sum + (s.tables?.length || 0), 0);
    // Count whitelisted tables
    const whitelistedTables = whitelistedDb.schemas.reduce((sum, s) => sum + (s.tables?.length || 0), 0);
    if (totalTables === 0 || whitelistedTables >= totalTables) return 'full';
    return 'partial';
  })();
  // Load context file content for whitelist toggle
  const contextFileState = useFile(contextId, { skip: !contextId })?.fileState;
  const contextContent = contextFileState?.content as ContextContent | undefined;
  const userId = useAppSelector((state) => state.auth.user?.id);
  const [whitelistToggling, setWhitelistToggling] = useState(false);

  const handleWhitelistToggle = useCallback(async () => {
    if (!contextId || !contextContent?.versions || !userId) return;
    setWhitelistToggling(true);
    try {
      const publishedVersion = getPublishedVersion(contextContent);
      const versionContent = contextContent.versions.find(v => v.version === publishedVersion);
      if (!versionContent) return;

      // Get current databases in editor format
      // parentSchema has all available connections (what the context CAN whitelist)
      const availableDbs = contextContent.parentSchema || contextContent.fullSchema || [];

      // Convert current whitelist to DatabaseContext[] for editing
      const currentDatabases: DatabaseContext[] = availableDbs.map(db => {
        // Find what's currently whitelisted for this db
        const whitelistedInContext = contextDatabases.find(cd => cd.databaseName === db.databaseName);
        if (whitelistedInContext && whitelistedInContext.schemas.length > 0) {
          return {
            databaseName: db.databaseName,
            whitelist: whitelistedInContext.schemas.map(s => ({ type: 'schema' as const, name: s.schema })),
          };
        }
        return { databaseName: db.databaseName, whitelist: [] };
      });

      // Toggle this connection
      const dbIndex = currentDatabases.findIndex(db => db.databaseName === fileName);
      const shouldWhitelist = whitelistStatus === 'none';

      if (dbIndex >= 0) {
        currentDatabases[dbIndex] = {
          ...currentDatabases[dbIndex],
          whitelist: shouldWhitelist
            ? (availableDbs.find(db => db.databaseName === fileName)?.schemas || []).map(s => ({ type: 'schema' as const, name: s.schema }))
            : [],
        };
      } else if (shouldWhitelist) {
        const dbSchemas = availableDbs.find(db => db.databaseName === fileName)?.schemas || [];
        currentDatabases.push({
          databaseName: fileName,
          whitelist: dbSchemas.map(s => ({ type: 'schema' as const, name: s.schema })),
        });
      }

      // Convert to storage format and update version
      const newWhitelist = convertDatabaseContextToWhitelist(currentDatabases);
      const updatedVersions = contextContent.versions.map(v => {
        if (v.version === publishedVersion) {
          return { ...v, whitelist: newWhitelist, lastEditedAt: new Date().toISOString(), lastEditedBy: userId };
        }
        return v;
      });

      // Edit and publish
      editFile({ fileId: contextId, changes: { content: { ...contextContent, versions: updatedVersions } as ContextContent } });
      await publishFile({ fileId: contextId });
    } catch (error) {
      console.error('Failed to toggle whitelist:', error);
    } finally {
      setWhitelistToggling(false);
    }
  }, [contextId, contextContent, userId, contextDatabases, fileName, whitelistStatus]);

  // Per-schema whitelist toggle (for static connection datasets)
  const handleSchemaWhitelistToggle = useCallback(async (schemaName: string) => {
    if (!contextId || !contextContent?.versions || !userId) return;
    setWhitelistToggling(true);
    try {
      const publishedVersion = getPublishedVersion(contextContent);
      const versionContent = contextContent.versions.find(v => v.version === publishedVersion);
      if (!versionContent) return;

      const availableDbs = contextContent.parentSchema || contextContent.fullSchema || [];

      const currentDatabases: DatabaseContext[] = availableDbs.map(db => {
        const whitelistedInContext = contextDatabases.find(cd => cd.databaseName === db.databaseName);
        if (whitelistedInContext && whitelistedInContext.schemas.length > 0) {
          return {
            databaseName: db.databaseName,
            whitelist: whitelistedInContext.schemas.map(s => ({ type: 'schema' as const, name: s.schema })),
          };
        }
        return { databaseName: db.databaseName, whitelist: [] };
      });

      const dbIndex = currentDatabases.findIndex(db => db.databaseName === fileName);
      if (dbIndex < 0) {
        // Connection not in whitelist yet — add it with just this schema
        currentDatabases.push({
          databaseName: fileName,
          whitelist: [{ type: 'schema' as const, name: schemaName }],
        });
      } else {
        const existing = currentDatabases[dbIndex];
        const schemaInWhitelist = existing.whitelist.some(w => w.type === 'schema' && w.name === schemaName);
        if (schemaInWhitelist) {
          // Remove this schema
          currentDatabases[dbIndex] = {
            ...existing,
            whitelist: existing.whitelist.filter(w => !(w.type === 'schema' && w.name === schemaName)),
          };
        } else {
          // Add this schema
          currentDatabases[dbIndex] = {
            ...existing,
            whitelist: [...existing.whitelist, { type: 'schema' as const, name: schemaName }],
          };
        }
      }

      const newWhitelist = convertDatabaseContextToWhitelist(currentDatabases);
      const updatedVersions = contextContent.versions.map(v => {
        if (v.version === publishedVersion) {
          return { ...v, whitelist: newWhitelist, lastEditedAt: new Date().toISOString(), lastEditedBy: userId };
        }
        return v;
      });

      editFile({ fileId: contextId, changes: { content: { ...contextContent, versions: updatedVersions } as ContextContent } });
      await publishFile({ fileId: contextId });
    } catch (error) {
      console.error('Failed to toggle schema whitelist:', error);
    } finally {
      setWhitelistToggling(false);
    }
  }, [contextId, contextContent, userId, contextDatabases, fileName]);

  // Add context doc handler
  const [contextInput, setContextInput] = useState('');
  const [contextAdding, setContextAdding] = useState(false);
  const [contextAdded, setContextAdded] = useState(false);
  const [contextExpanded, setContextExpanded] = useState(false);

  // Enriched schema viewer (dev mode only)
  const [schemaJsonExpanded, setSchemaJsonExpanded] = useState(false);

  const handleAddContext = useCallback(async () => {
    if (!contextId || !contextContent?.versions || !userId || !contextInput.trim()) return;
    setContextAdding(true);
    try {
      const publishedVersion = getPublishedVersion(contextContent);
      const updatedVersions = contextContent.versions.map(v => {
        if (v.version === publishedVersion) {
          return {
            ...v,
            docs: [...(v.docs || []), { content: contextInput.trim() }],
            lastEditedAt: new Date().toISOString(),
            lastEditedBy: userId,
          };
        }
        return v;
      });

      editFile({ fileId: contextId, changes: { content: { ...contextContent, versions: updatedVersions } as ContextContent } });
      await publishFile({ fileId: contextId });
      setContextInput('');
      setContextAdded(true);
    } catch (error) {
      console.error('Failed to add context:', error);
    } finally {
      setContextAdding(false);
    }
  }, [contextId, contextContent, userId, contextInput]);

  // Reusable add-context-doc callback (for passing to child components)
  const handleAddContextDoc = useCallback(async (text: string) => {
    if (!contextId || !contextContent?.versions || !userId || !text.trim()) return;
    const publishedVersion = getPublishedVersion(contextContent);
    const updatedVersions = contextContent.versions.map(v => {
      if (v.version === publishedVersion) {
        return {
          ...v,
          docs: [...(v.docs || []), { content: text.trim() }],
          lastEditedAt: new Date().toISOString(),
          lastEditedBy: userId,
        };
      }
      return v;
    });
    editFile({ fileId: contextId, changes: { content: { ...contextContent, versions: updatedVersions } as ContextContent } });
    await publishFile({ fileId: contextId });
  }, [contextId, contextContent, userId]);

  const [redirectingToStatic, setRedirectingToStatic] = useState<false | 'csv' | 'sheets'>(false);

  useEffect(() => {
    if (redirectingToStatic && staticConnectionFile?.fileState.id && staticConnectionFile.fileState.id > 0) {
      const modeParam = userMode !== 'org' ? `&mode=${userMode}` : '';
      router.push(`/f/${staticConnectionFile.fileState.id}?tab=${redirectingToStatic}${modeParam}`);
    }
  }, [redirectingToStatic, staticConnectionFile?.fileState.id, userMode, router]);

  // For create mode, start with type selection step; skip if already editing
  const [step, setStep] = useState<'select-type' | 'configure'>(mode === 'create' ? 'select-type' : 'configure');
  // For existing connections, default to 'tables' view; for new connections, show 'settings'.
  // Static connection: defaults to 'tables' unless arriving via ?tab= param (means user
  // clicked CSV/Google Sheets from the type selection and wants to upload).
  const isStaticConnection = content.type === 'csv' && fileName === 'static';
  const searchParams = useSearchParams();
  const hasTabParam = searchParams.has('tab');
  const [activeSection, setActiveSection] = useState<'tables' | 'settings'>(
    mode === 'view' && !(isStaticConnection && hasTabParam) ? 'tables' : 'settings'
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
  const handleTypeSelect = (selectedType: 'bigquery' | 'postgresql' | 'csv' | 'google-sheets' | 'athena') => {
    // CSV and Google Sheets always go to the static connection — no new connection is created
    if (selectedType === 'csv' || selectedType === 'google-sheets') {
      const tab = selectedType === 'google-sheets' ? 'sheets' : 'csv';
      // In wizard mode, notify parent instead of navigating away
      if (onStaticSelect) {
        onStaticSelect(tab);
        return;
      }
      if (staticConnectionFile?.fileState.id && staticConnectionFile.fileState.id > 0) {
        const modeParam = userMode !== 'org' ? `&mode=${userMode}` : '';
        router.push(`/f/${staticConnectionFile.fileState.id}?tab=${tab}${modeParam}`);
      } else {
        setRedirectingToStatic(tab);
      }
      return;
    }
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
      if (fileName !== 'static' && !config.files?.length) return false;
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
                  Add Connection
                </Heading>
                <Text color="fg.muted" fontSize="sm">
                  Select a database type to connect to
                </Text>
              </>
            )}
          </VStack>

          {/* Loading bar while resolving static connection */}
          {(redirectingToStatic || staticConnectionLoading) && (
            <Progress.Root size="xs" value={null} colorPalette="teal">
              <Progress.Track borderRadius="full">
                <Progress.Range />
              </Progress.Track>
            </Progress.Root>
          )}

          {/* Connection Type Cards */}
          <SimpleGrid columns={{ base: 2, md: 4 }} gap={3}>
            {CONNECTION_TYPES.map((connType) => (
              <Box
                key={connType.type}
                as="button"
                onClick={() => !connType.comingSoon && handleTypeSelect(connType.type as 'bigquery' | 'postgresql' | 'csv' | 'google-sheets' | 'athena')}
                px={4}
                py={4}
                borderRadius="lg"
                border="1px solid"
                borderColor="border.default"
                bg="bg.surface"
                cursor={connType.comingSoon ? 'not-allowed' : 'pointer'}
                textAlign="center"
                transition="all 0.15s"
                position="relative"
                opacity={connType.comingSoon ? 0.45 : 1}
                _hover={connType.comingSoon ? {} : {
                  borderColor: 'accent.teal',
                  bg: 'bg.muted',
                }}
              >
                {connType.comingSoon && (
                  <Text
                    position="absolute"
                    top={1.5}
                    right={2}
                    fontSize="2xs"
                    color="fg.muted"
                    fontWeight="600"
                  >
                    Soon
                  </Text>
                )}
                <VStack gap={2}>
                  <Box
                    w="36px"
                    h="36px"
                    position="relative"
                    flexShrink={0}
                  >
                    <Image
                      src={connType.logo}
                      alt={connType.name}
                      fill
                      style={{ objectFit: 'contain' }}
                    />
                  </Box>
                  <VStack gap={0}>
                    <Text fontWeight="600" fontSize="sm" fontFamily="mono" color="fg.default">
                      {connType.name}
                    </Text>
                    {('note' in connType) && (connType as { note?: string }).note && (
                      <Text fontSize="2xs" color="fg.muted">
                        {(connType as { note?: string }).note}
                      </Text>
                    )}
                  </VStack>
                </VStack>
              </Box>
            ))}
          </SimpleGrid>
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
                <LuArrowLeft size={20} />
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
                {isStaticConnection ? (
                  <StaticTablesBrowser
                    schemas={schemas}
                    schemaLoading={schemaLoading}
                    schemaError={schemaError}
                    connectionName={fileName}
                    onRetry={handleSchemaReload}
                    whitelistedSchemas={whitelistedDb?.schemas}
                    contextId={contextId}
                    onSchemaWhitelistToggle={handleSchemaWhitelistToggle}
                    whitelistToggling={whitelistToggling}
                    onAddContext={handleAddContextDoc}
                    hasContextDocs={!!contextDocs}
                  />
                ) : (
                  <ConnectionTablesBrowser
                    schemas={schemas}
                    schemaLoading={schemaLoading}
                    schemaError={schemaError}
                    connectionName={fileName}
                    onRetry={handleSchemaReload}
                  />
                )}
              </Box>
            </VStack>

            {/* Right: Quick Actions — hide for static (context is per-dataset) and duckdb */}
            {content.type !== 'duckdb' && !isStaticConnection && (
              <Box
                w="300px"
                flexShrink={0}
                borderRadius="lg"
                border="1px solid"
                borderColor="border.default"
                bg="bg.surface"
                p={4}
              >
                <Text fontSize="sm" fontWeight="700" mb={3} fontFamily="mono">
                  Quick Actions
                </Text>
                <VStack align="stretch" gap={1}>
                  {/* 1. Whitelist Tables — toggle */}
                  <HStack
                    gap={2.5}
                    px={3}
                    py={2}
                    borderRadius="md"
                    justify="space-between"
                  >
                    <VStack align="start" gap={0}>
                      <Text fontSize="xs" fontWeight="600" fontFamily="mono">
                        Whitelist Tables
                      </Text>
                      <Text fontSize="2xs" color="fg.muted" fontFamily="mono">
                        {whitelistStatus === 'full' ? 'All tables in knowledge base' : whitelistStatus === 'partial' ? 'Some tables selected' : 'Currently not in knowledge base'}
                      </Text>
                      {contextId && (
                        <Link href={`/f/${contextId}?tab=databases`} target="_blank">
                          <Text fontSize="2xs" color="fg.muted" fontFamily="mono" lineHeight="1" _hover={{ color: 'accent.teal' }}>
                            See all table selections →
                          </Text>
                        </Link>
                      )}
                    </VStack>
                    <Switch.Root
                      checked={whitelistStatus !== 'none'}
                      onCheckedChange={() => handleWhitelistToggle()}
                      disabled={whitelistToggling || !contextId}
                      size="sm"
                      colorPalette="teal"
                    >
                      <Switch.HiddenInput />
                      <Switch.Control>
                        <Switch.Thumb />
                      </Switch.Control>
                    </Switch.Root>
                  </HStack>

                  {/* 2. Add Context — expandable inline form */}
                  <VStack align="stretch" gap={0} px={3} py={2}>
                    {contextAdded ? (
                      <>
                        <HStack gap={2.5}>
                          <LuCheck size={14} color="var(--chakra-colors-accent-teal)" />
                          <Text fontSize="xs" fontWeight="600" fontFamily="mono" color="accent.teal">
                            Context Saved
                          </Text>
                        </HStack>
                        {contextId && (
                          <Link href={`/f/${contextId}?tab=docs`} target="_blank">
                            <Text fontSize="2xs" color="fg.muted" fontFamily="mono" _hover={{ color: 'accent.teal' }} mt={1} ml={6}>
                              See full knowledge base →
                            </Text>
                          </Link>
                        )}
                      </>
                    ) : (
                      <>
                        <HStack justify="space-between">
                          <VStack align="start" gap={0}>
                            <Text fontSize="xs" fontWeight="600" fontFamily="mono">
                              Add Context
                            </Text>
                            {contextDocs && contextId && (
                              <Link href={`/f/${contextId}?tab=docs`} target="_blank">
                                <Text fontSize="2xs" color="fg.muted" fontFamily="mono" _hover={{ color: 'accent.teal' }}>
                                  See existing docs →
                                </Text>
                              </Link>
                            )}
                          </VStack>
                          <Button
                            size="2xs"
                            variant="outline"
                            onClick={() => setContextExpanded(!contextExpanded)}
                            fontSize="2xs"
                            fontFamily="mono"
                          >
                            {contextExpanded ? 'Hide' : 'Add'}
                          </Button>
                        </HStack>
                        {contextExpanded && (
                          <VStack align="stretch" gap={1.5} mt={2}>
                            <Box position="relative">
                              <Textarea
                                value={contextInput}
                                onChange={(e) => setContextInput(e.target.value)}
                                placeholder={`Describe the ${fileName} dataset...`}
                                fontFamily="mono"
                                fontSize="2xs"
                                minH="50px"
                                resize="vertical"
                                pr="36px"
                              />
                              <Box position="absolute" bottom="8px" right="8px">
                                <Button
                                  size="2xs"
                                  bg="accent.teal"
                                  color="white"
                                  onClick={handleAddContext}
                                  loading={contextAdding}
                                  disabled={!contextInput.trim() || !contextId}
                                  borderRadius="full"
                                  p={0}
                                  minW="24px"
                                  h="24px"
                                >
                                  <LuPlus size={12} />
                                </Button>
                              </Box>
                            </Box>
                          </VStack>
                        )}
                      </>
                    )}
                  </VStack>

                  <Box h="1px" bg="border.default" my={2} />

                  {/* 3. New Question */}
                  <Link href={`/new/question?databaseName=${encodeURIComponent(fileName)}`}>
                    <HStack
                      gap={2.5}
                      px={3}
                      py={2}
                      borderRadius="md"
                      _hover={{ bg: 'bg.muted' }}
                      transition="all 0.15s"
                      cursor="pointer"
                    >
                      <LuPlus size={14} color="var(--chakra-colors-accent-teal)" />
                      <Text fontSize="xs" fontWeight="600" fontFamily="mono">New Question</Text>
                    </HStack>
                  </Link>

                  {/* 4. Auto Dashboard */}
                  <Link href={`/new/dashboard`}>
                    <HStack
                      gap={2.5}
                      px={3}
                      py={2}
                      borderRadius="md"
                      _hover={{ bg: 'bg.muted' }}
                      transition="all 0.15s"
                      cursor="pointer"
                    >
                      <LuLayoutDashboard size={14} color="var(--chakra-colors-accent-teal)" />
                      <Text fontSize="xs" fontWeight="600" fontFamily="mono">New Dashboard</Text>
                    </HStack>
                  </Link>

                  {/* 5. Explore */}
                  <Link href={`/explore`}>
                    <HStack
                      gap={2.5}
                      px={3}
                      py={2}
                      borderRadius="md"
                      _hover={{ bg: 'bg.muted' }}
                      transition="all 0.15s"
                      cursor="pointer"
                    >
                      <LuCompass size={14} color="var(--chakra-colors-accent-teal)" />
                      <Text fontSize="xs" fontWeight="600" fontFamily="mono">Explore</Text>
                    </HStack>
                  </Link>

                </VStack>
              </Box>
            )}
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
                      fontFamily: 'JetBrains Mono, monospace',
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
          {isStaticConnection && (
            <HStack gap={2} mt={2} px={3} py={2} bg="accent.teal/5" borderRadius="md" border="1px solid" borderColor="accent.teal/20">
              <LuCircleAlert size={13} color="var(--chakra-colors-accent-teal)" style={{ flexShrink: 0 }} />
              <Text fontSize="xs" color="fg.muted">
                All uploaded CSV, Parquet, and Google Sheets datasets are stored in this connection.
              </Text>
            </HStack>
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

        {/* Static connection — unified CSV + Google Sheets landing zone */}
        {content.type === 'csv' && fileName === 'static' && (
          <StaticConnectionConfig
            config={config}
            onChange={(newConfig) => onChange({ config: newConfig })}
            mode={mode}
            userMode={userMode}
            onError={setNameError}
            onPendingDeletion={onPendingDeletion}
            onSave={onSave}
          />
        )}

        {/* CSV Configuration (non-static, backward compat) */}
        {content.type === 'csv' && fileName !== 'static' && (
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
            disabled={!isDirty || !isFormValidForTest()}
            size="sm"
            bg="accent.teal"
            color="white"
          >
            <LuSave />
            Save Connection
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
