'use client';

import { useState, useEffect } from 'react';
import { Box, Flex, Text, Button, Input, VStack, Icon, Dialog, Portal } from '@chakra-ui/react';
import { LuDownload, LuUpload, LuCircleCheck, LuCircleX, LuLoader, LuChevronDown, LuChevronRight, LuRotateCcw } from 'react-icons/lu';
import { fetchWithCache } from '@/lib/http/fetch-wrapper';
import { API } from '@/lib/http/declarations';
import { MINIMUM_SUPPORTED_DATA_VERSION } from '@/lib/database/constants';
import ValidationStatusDisplay from './ValidationStatusDisplay';
import MigrationStatusDisplay from './MigrationStatusDisplay';
import BackfillConversationsSection from './BackfillConversationsSection';
import ClearLlmLogsSection from './ClearLlmLogsSection';

export interface ValidationStatus {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface VersionInfo {
  current: {
    data: number;
    schema: number;
  };
  target: {
    data: number;
    schema: number;
  };
  upToDate: boolean;
}

export interface MigrationResult {
  success: boolean;
  message?: string;
  migrations: string[];
  versions?: VersionInfo;
  validation?: ValidationStatus;
  errors?: string[];
  warnings?: string[];
}

export default function DataManagementSection() {
  const [exportStatus, setExportStatus] = useState<ValidationStatus | null>(null);
  const [validateStatus, setValidateStatus] = useState<ValidationStatus | null>(null);
  const [importStatus, setImportStatus] = useState<ValidationStatus | null>(null);
  const [migrateStatus, setMigrateStatus] = useState<MigrationResult | null>(null);
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [currentVersion, setCurrentVersion] = useState<number | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [isResettingTutorial, setIsResettingTutorial] = useState(false);
  const [showResetTutorialConfirm, setShowResetTutorialConfirm] = useState(false);
  const [resetTutorialStatus, setResetTutorialStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [isBackfillingViz, setIsBackfillingViz] = useState(false);
  const [vizBackfillStatus, setVizBackfillStatus] = useState<{ success: boolean; message: string; skipped?: Array<{ id: number; name: string; reason: string }> } | null>(null);
  const [showVizSkipped, setShowVizSkipped] = useState(false);
  const [expandedErrors, setExpandedErrors] = useState<'export' | 'validate' | 'import' | 'migrate' | null>(null);
  const [uploadedData, setUploadedData] = useState<any>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [showUploadedData, setShowUploadedData] = useState(false);

  // Fetch current database version on mount
  useEffect(() => {
    fetchWithCache('/api/admin/db-version', {
      method: 'GET',
      cacheStrategy: API.admin.dbVersion.cache,
    })
      .then(data => setCurrentVersion(data.version))
      .catch(err => console.error('Failed to fetch DB version:', err));
  }, []);

  const handleExport = async () => {
    setIsExporting(true);
    setExportStatus(null);

    try {
      // Note: Using direct fetch for file download (blob response + custom headers)
      // This is intentionally not using fetchWithCache as it needs Response headers
      const response = await fetch('/api/admin/export-db');

      if (!response.ok) {
        throw new Error('Export failed');
      }

      // Check validation headers
      const validationStatus = response.headers.get('X-Validation-Status');
      const validationErrors = response.headers.get('X-Validation-Errors');

      const valid = validationStatus !== 'invalid';
      const errors = validationErrors ? JSON.parse(validationErrors) : [];

      setExportStatus({
        valid,
        errors,
        warnings: []
      });

      // Download the file (now gzipped)
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `atlas_export_${new Date().toISOString().split('T')[0]}.json.gz`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      setExportStatus({
        valid: false,
        errors: ['Failed to export database'],
        warnings: []
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleValidate = async () => {
    setIsValidating(true);
    setValidateStatus(null);
    setVersionInfo(null);

    try {
      const result = await fetchWithCache('/api/admin/validate-db', {
        method: 'GET',
        cacheStrategy: API.admin.validateDb.cache,
      });

      setValidateStatus({
        valid: result.valid,
        errors: result.errors || [],
        warnings: result.warnings || []
      });

      setVersionInfo(result.versions);
    } catch (error) {
      setValidateStatus({
        valid: false,
        errors: ['Failed to validate database'],
        warnings: []
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportStatus(null);
    setUploadedData(null);
    setUploadedFile(null);
    setShowUploadedData(false);

    try {
      const isGzipped = file.name.endsWith('.gz');

      if (isGzipped) {
        // For gzipped files, skip client-side validation (server will validate)
        // Note: Version validation still happens on server
        setUploadedFile(file);
        setImportStatus({
          valid: true,
          errors: [],
          warnings: [`${file.name} ready for import (validation will occur on server)`]
        });
      } else {
        // Parse the file to show preview (JSON only)
        const fileContent = await file.text();
        let parsedData;

        try {
          parsedData = JSON.parse(fileContent);

          // Validate version FIRST (before structure checks)
          if (currentVersion !== null && parsedData.version < MINIMUM_SUPPORTED_DATA_VERSION) {
            setImportStatus({
              valid: false,
              errors: [
                `File is v${parsedData.version}, minimum supported version is v${MINIMUM_SUPPORTED_DATA_VERSION}. Re-export from a newer system.`,
              ],
              warnings: []
            });
            event.target.value = '';
            return;
          }

          // Basic structure validation (nested format check)
          const nestedOrgs = parsedData.orgs ?? parsedData.companies;
          const hasNestedStructure = nestedOrgs && Array.isArray(nestedOrgs) && nestedOrgs.length > 0;
          const firstOrg = nestedOrgs?.[0];
          const isNestedFormat = firstOrg && ('users' in firstOrg || 'documents' in firstOrg);

          if (!hasNestedStructure) {
            throw new Error('Invalid data structure: missing orgs array');
          }

          if (!isNestedFormat) {
            throw new Error('Invalid data format: expected nested format with users and documents');
          }

          // Validate exactly 1 org for web UI
          if (nestedOrgs.length !== 1) {
            setImportStatus({
              valid: false,
              errors: [
                `File must contain exactly 1 org (found ${nestedOrgs.length})`,
                'Web UI only supports single-org imports. Use CLI for multi-org imports.'
              ],
              warnings: []
            });
            event.target.value = '';
            return;
          }

          const firstOrgEntry = nestedOrgs[0];
          setUploadedData(parsedData);
          setUploadedFile(file);

          // Show ready to import with org details
          const warnings = [
            `${firstOrgEntry.display_name}: ${firstOrgEntry.users.length} users, ${firstOrgEntry.documents.length} documents`,
            '⚠ This will OVERWRITE your current data'
          ];
          if (currentVersion !== null && parsedData.version < currentVersion) {
            warnings.unshift(`File is v${parsedData.version}, DB is v${currentVersion} — migrations will be applied automatically`);
          }
          setImportStatus({
            valid: true,
            errors: [],
            warnings
          });
        } catch (parseError: any) {
          setImportStatus({
            valid: false,
            errors: [`Invalid JSON file: ${parseError.message}`],
            warnings: []
          });
          event.target.value = '';
          return;
        }
      }
    } catch (error) {
      setImportStatus({
        valid: false,
        errors: ['Failed to read file'],
        warnings: []
      });
    } finally {
      // Reset file input
      event.target.value = '';
    }
  };

  const handleConfirmImport = async () => {
    if (!uploadedFile || !importStatus?.valid) return;

    setIsImporting(true);

    try {
      const formData = new FormData();
      formData.append('file', uploadedFile);

      // Note: Using direct fetch for file upload (FormData with multipart/form-data)
      // This is intentionally not using fetchWithCache as FormData requires special handling
      const response = await fetch('/api/admin/import-data', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (result.success) {
        setImportStatus({
          valid: true,
          errors: [],
          warnings: [`✓ ${result.message}`, ...(result.warnings || [])]
        });
        // Reload page after successful import (delay to ensure DB and connections reset)
        setTimeout(() => {
          // Force hard reload (bypass cache)
          window.location.href = window.location.href;
        }, 2000);
      } else {
        setImportStatus({
          valid: false,
          errors: result.errors || ['Import failed'],
          warnings: result.warnings || []
        });
      }
    } catch (error) {
      setImportStatus({
        valid: false,
        errors: ['Failed to import workspace data'],
        warnings: []
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleMigrate = async () => {
    setIsMigrating(true);
    setMigrateStatus(null);

    try {
      // If database is up to date, force empty migration (export/import)
      const force = versionInfo?.upToDate === true;

      const result = await fetchWithCache('/api/admin/migrate-db', {
        method: 'POST',
        body: JSON.stringify({ force }),
        cacheStrategy: API.admin.migrateDb.cache,
      });

      setMigrateStatus(result);

      // Update version info from migration result
      if (result.versions) {
        setVersionInfo({
          current: result.versions.current,
          target: result.versions.target,
          upToDate: result.versions.current.data === result.versions.target.data &&
                    result.versions.current.schema === result.versions.target.schema
        });
      }

      // Reload page after successful migration (including empty migrations)
      // But not if it just said "already up to date" without running anything
      if (result.success && (force || result.migrations.length > 0)) {
        setTimeout(() => window.location.reload(), 2000);
      }
    } catch (error) {
      setMigrateStatus({
        success: false,
        migrations: [],
        errors: ['Failed to run migrations'],
        warnings: []
      });
    } finally {
      setIsMigrating(false);
    }
  };

  const handleResetTutorial = async () => {
    setShowResetTutorialConfirm(false);
    setIsResettingTutorial(true);
    setResetTutorialStatus(null);

    try {
      const result = await fetchWithCache('/api/admin/reset-tutorial', {
        method: 'POST',
        cacheStrategy: API.admin.resetTutorial.cache,
      });

      setResetTutorialStatus({
        success: result.success,
        message: result.message || (result.success ? 'Tutorial reset successfully' : 'Reset failed'),
      });
    } catch (error) {
      setResetTutorialStatus({ success: false, message: 'Failed to reset tutorial' });
    } finally {
      setIsResettingTutorial(false);
    }
  };

  const handleVizBackfill = async (dryRun: boolean) => {
    setIsBackfillingViz(true);
    setVizBackfillStatus(null);
    try {
      // overwrite: reruns re-derive every envelope from the (never-modified) classic
      // settings, so the backfill converges instead of accumulating stale derivations.
      const result = await fetchWithCache('/api/viz/backfill', {
        method: 'POST',
        body: JSON.stringify({ dryRun, overwrite: true }),
        cacheStrategy: API.admin.vizBackfill.cache,
      });
      const d = result.data ?? {};
      setShowVizSkipped(false);
      setVizBackfillStatus({
        success: result.success === true,
        message: result.success
          ? `${dryRun ? 'Dry run: ' : ''}${d.upgraded} added, ${d.overwritten} re-derived, ${d.skipped?.length ?? 0} skipped`
          : (result.error || 'Backfill failed'),
        skipped: result.success ? (d.skipped ?? []) : [],
      });
    } catch (error) {
      setVizBackfillStatus({ success: false, message: 'Failed to run viz backfill' });
    } finally {
      setIsBackfillingViz(false);
    }
  };

  return (
    <Box>
      <VStack align="stretch" gap={0} divideY="1px">
        {/* Export */}
        <Box py={4} px={4}>
          <Flex justify="space-between" align="center" mb={exportStatus ? 2 : 0}>
            <Text fontSize="sm" fontWeight="medium" fontFamily="mono">
              Export Workspace Data
            </Text>
            <Button
              size="sm"
              variant="outline"
              onClick={handleExport}
              disabled={isExporting}
              fontFamily="mono"
            >
              {isExporting ? (
                <>
                  <Icon fontSize="md" mr={1}>
                    <LuLoader className="animate-spin" />
                  </Icon>
                  Exporting...
                </>
              ) : (
                <>
                  <Icon fontSize="md" mr={1}>
                    <LuDownload />
                  </Icon>
                  Download
                </>
              )}
            </Button>
          </Flex>
          <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={exportStatus ? 2 : 0}>
            Export your workspace data to compressed JSON file (.json.gz)
          </Text>
          <ValidationStatusDisplay status={exportStatus} type="export" expandedErrors={expandedErrors} setExpandedErrors={setExpandedErrors} />
        </Box>

        {/* Validate */}
        <Box py={4} px={4}>
          <Flex justify="space-between" align="center" mb={validateStatus ? 2 : 0}>
            <Flex align="center" gap={2}>
              <Text fontSize="sm" fontWeight="medium" fontFamily="mono">
                Validate Data
              </Text>
              {validateStatus && (
                <Icon fontSize="lg" color={validateStatus.valid ? 'accent.teal' : 'accent.danger'}>
                  {validateStatus.valid ? <LuCircleCheck /> : <LuCircleX />}
                </Icon>
              )}
            </Flex>
            <Button
              size="sm"
              variant="outline"
              onClick={handleValidate}
              disabled={isValidating}
              fontFamily="mono"
            >
              {isValidating ? 'Checking...' : 'Check'}
            </Button>
          </Flex>
          <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={validateStatus || versionInfo ? 2 : 0}>
            Check current data integrity and version
          </Text>

          {/* Version Info */}
          {versionInfo && (
            <Box mt={2} p={2} bg="bg.muted" borderRadius="md" borderWidth="1px" borderColor="border">
              <VStack align="stretch" gap={1}>
                <Flex justify="space-between" fontSize="xs" fontFamily="mono">
                  <Text color="fg.muted">Data Version:</Text>
                  <Text color="fg">
                    {versionInfo.current.data}
                    {versionInfo.current.data !== versionInfo.target.data && (
                      <Text as="span" color="accent.warning"> → {versionInfo.target.data}</Text>
                    )}
                  </Text>
                </Flex>
                <Flex justify="space-between" fontSize="xs" fontFamily="mono">
                  <Text color="fg.muted">Schema Version:</Text>
                  <Text color="fg">
                    {versionInfo.current.schema}
                    {versionInfo.current.schema !== versionInfo.target.schema && (
                      <Text as="span" color="accent.warning"> → {versionInfo.target.schema}</Text>
                    )}
                  </Text>
                </Flex>
                <Flex justify="space-between" fontSize="xs" fontFamily="mono">
                  <Text color="fg.muted">Status:</Text>
                  <Text color={versionInfo.upToDate ? 'accent.teal' : 'accent.warning'} fontWeight="medium">
                    {versionInfo.upToDate ? '✓ Up to date' : '⚠ Migration available'}
                  </Text>
                </Flex>
              </VStack>
            </Box>
          )}

          <ValidationStatusDisplay status={validateStatus} type="validate" expandedErrors={expandedErrors} setExpandedErrors={setExpandedErrors} />
        </Box>

        {/* Migrate */}
        <Box py={4} px={4}>
          <Flex justify="space-between" align="center" mb={migrateStatus ? 2 : 0}>
            <Flex align="center" gap={2}>
              <Text fontSize="sm" fontWeight="medium" fontFamily="mono">
                Run Migrations
              </Text>
              {migrateStatus && (
                <Icon fontSize="lg" color={migrateStatus.success ? 'accent.teal' : 'accent.danger'}>
                  {migrateStatus.success ? <LuCircleCheck /> : <LuCircleX />}
                </Icon>
              )}
            </Flex>
            <Button
              size="sm"
              variant="outline"
              onClick={handleMigrate}
              disabled={isMigrating}
              fontFamily="mono"
            >
              {isMigrating ? (
                <>
                  <Icon fontSize="md" mr={1}>
                    <LuLoader className="animate-spin" />
                  </Icon>
                  Migrating...
                </>
              ) : (
                versionInfo?.upToDate ? 'Run empty migration' : 'Migrate'
              )}
            </Button>
          </Flex>
          <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={migrateStatus ? 2 : 0}>
            {versionInfo?.upToDate
              ? 'Export and re-import data without migrations (useful for testing or fixing data issues)'
              : 'Apply pending database migrations'}
          </Text>
          <MigrationStatusDisplay result={migrateStatus} expandedErrors={expandedErrors} setExpandedErrors={setExpandedErrors} />
        </Box>

        {/* Viz V2 backfill */}
        <Box py={4} px={4}>
          <Flex justify="space-between" align="center" mb={vizBackfillStatus ? 2 : 0}>
            <Flex align="center" gap={2}>
              <Text fontSize="sm" fontWeight="medium" fontFamily="mono">
                Backfill Viz V2 Envelopes
              </Text>
              {vizBackfillStatus && (
                <Icon fontSize="lg" color={vizBackfillStatus.success ? 'accent.teal' : 'accent.danger'}>
                  {vizBackfillStatus.success ? <LuCircleCheck /> : <LuCircleX />}
                </Icon>
              )}
            </Flex>
            <Flex gap={2}>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleVizBackfill(true)}
                disabled={isBackfillingViz}
                fontFamily="mono"
                aria-label="Dry run Viz V2 backfill"
              >
                Dry run
              </Button>
              <Button
                size="sm"
                variant="solid"
                colorPalette="teal"
                onClick={() => handleVizBackfill(false)}
                disabled={isBackfillingViz}
                fontFamily="mono"
                aria-label="Backfill Viz V2 envelopes"
              >
                {isBackfillingViz ? (
                  <>
                    <Icon fontSize="md" mr={1}>
                      <LuLoader className="animate-spin" />
                    </Icon>
                    Running...
                  </>
                ) : (
                  'Run backfill'
                )}
              </Button>
            </Flex>
          </Flex>
          <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={vizBackfillStatus ? 2 : 0}>
            Derive a V2 viz for every question from its classic settings (executing each query for real result columns).
            Rerun-safe: reruns re-derive and overwrite the V2 viz, but hand-authored charts are never downgraded, and
            classic viz settings are NEVER modified — switching the format default back always remains possible.
          </Text>
          {vizBackfillStatus && (
            <Text fontSize="xs" fontFamily="mono" color={vizBackfillStatus.success ? 'accent.teal' : 'accent.danger'}>
              {vizBackfillStatus.message}
            </Text>
          )}
          {(vizBackfillStatus?.skipped?.length ?? 0) > 0 && (
            <Box mt={1}>
              <Flex
                as="button"
                align="center"
                gap={1}
                cursor="pointer"
                onClick={() => setShowVizSkipped(v => !v)}
                aria-label="Toggle skipped files list"
                color="fg.muted"
              >
                <Icon fontSize="sm">{showVizSkipped ? <LuChevronDown /> : <LuChevronRight />}</Icon>
                <Text fontSize="xs" fontFamily="mono">
                  {vizBackfillStatus!.skipped!.length} skipped file{vizBackfillStatus!.skipped!.length === 1 ? '' : 's'}
                </Text>
              </Flex>
              {showVizSkipped && (
                <VStack align="stretch" gap={1} mt={1} maxH="200px" overflowY="auto" pl={5}>
                  {vizBackfillStatus!.skipped!.map(s => (
                    <Text key={s.id} fontSize="xs" fontFamily="mono" color="fg.muted">
                      <a href={`/f/${s.id}`} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }} aria-label={`Open skipped file ${s.name}`}>
                        #{s.id} {s.name}
                      </a>
                      {' — '}{s.reason}
                    </Text>
                  ))}
                </VStack>
              )}
            </Box>
          )}
        </Box>

        {/* Import */}
        <Box py={4} px={4}>
          <Flex justify="space-between" align="center" mb={2}>
            <Text fontSize="sm" fontWeight="medium" fontFamily="mono">
              Import Workspace Data
            </Text>
            <Flex gap={2}>
              <Input
                type="file"
                accept=".json,.json.gz,.gz"
                onChange={handleFileSelect}
                disabled={isImporting}
                display="none"
                id="import-file"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => document.getElementById('import-file')?.click()}
                disabled={isImporting}
                fontFamily="mono"
              >
                <Icon fontSize="md" mr={1}>
                  <LuUpload />
                </Icon>
                Select File
              </Button>

              {importStatus?.valid && !isImporting && (
                <Button
                  size="sm"
                  colorPalette="red"
                  onClick={handleConfirmImport}
                  disabled={isImporting}
                  fontFamily="mono"
                >
                  {isImporting ? (
                    <>
                      <Icon fontSize="md" mr={1}>
                        <LuLoader className="animate-spin" />
                      </Icon>
                      Importing...
                    </>
                  ) : (
                    'Overwrite Workspace Data'
                  )}
                </Button>
              )}
            </Flex>
          </Flex>
          <VStack align="stretch" gap={1} mb={importStatus ? 2 : 0}>
            <Text fontSize="xs" color="fg.muted" fontFamily="mono">
              Import your workspace data from a JSON file (.json or .json.gz)
            </Text>
            {currentVersion !== null && (
              <Text fontSize="xs" color="fg.muted" fontFamily="mono">
                Current: v{currentVersion} · Accepts v{MINIMUM_SUPPORTED_DATA_VERSION}+
              </Text>
            )}
          </VStack>
          <ValidationStatusDisplay status={importStatus} type="import" expandedErrors={expandedErrors} setExpandedErrors={setExpandedErrors} />

          {/* Show uploaded data preview */}
          {uploadedData && (
            <Box mt={3}>
              <Flex
                align="center"
                gap={2}
                cursor="pointer"
                onClick={() => setShowUploadedData(!showUploadedData)}
                mb={2}
              >
                <Icon fontSize="sm" color="fg.muted">
                  {showUploadedData ? <LuChevronDown /> : <LuChevronRight />}
                </Icon>
                <Text fontSize="xs" fontWeight="medium" color="fg.muted" fontFamily="mono">
                  Uploaded Data Preview ({(uploadedData.orgs ?? uploadedData.companies)?.length || 0} orgs, {uploadedData.users?.length || 0} users, {uploadedData.documents?.length || 0} documents)
                </Text>
              </Flex>

              {showUploadedData && (
                <Box
                  mt={2}
                  p={3}
                  bg="bg.muted"
                  borderRadius="md"
                  borderWidth="1px"
                  borderColor="border"
                  maxH="300px"
                  overflowY="auto"
                  fontSize="xs"
                  fontFamily="mono"
                  whiteSpace="pre"
                  color="fg"
                >
                  {JSON.stringify(uploadedData, null, 2)}
                </Box>
              )}
            </Box>
          )}

        </Box>

        {/* Backfill old conversations → v3 */}
        <BackfillConversationsSection />

        {/* Reset Tutorial */}
        <Box py={4} px={4}>
          <Flex justify="space-between" align="center" mb={resetTutorialStatus ? 2 : 0}>
            <Text fontSize="sm" fontWeight="medium" fontFamily="mono">
              Reset Tutorial & Other Modes
            </Text>
            <Button
              size="sm"
              colorPalette="red"
              variant="outline"
              onClick={() => setShowResetTutorialConfirm(true)}
              disabled={isResettingTutorial}
              fontFamily="mono"
            >
              {isResettingTutorial ? (
                <>
                  <Icon fontSize="md" mr={1}>
                    <LuLoader className="animate-spin" />
                  </Icon>
                  Resetting...
                </>
              ) : (
                <>
                  <Icon fontSize="md" mr={1}>
                    <LuRotateCcw />
                  </Icon>
                  Reset
                </>
              )}
            </Button>
          </Flex>
          <Text fontSize="xs" color="fg.muted" fontFamily="mono" mb={resetTutorialStatus ? 2 : 0}>
            Restore tutorial and other modes (internals, etc.) to their original state, removing any changes or files added in those modes
          </Text>
          {resetTutorialStatus && (
            <Text fontSize="xs" color={resetTutorialStatus.success ? 'accent.teal' : 'accent.danger'} fontFamily="mono">
              {resetTutorialStatus.success ? `✓ ${resetTutorialStatus.message}` : `✗ ${resetTutorialStatus.message}`}
            </Text>
          )}
        </Box>

        {/* Clear LLM Logs (raw request/response blobs only — stats are kept) */}
        <ClearLlmLogsSection />

      </VStack>

      {/* Reset Tutorial confirmation dialog */}
      <Dialog.Root open={showResetTutorialConfirm} onOpenChange={(e: { open: boolean }) => setShowResetTutorialConfirm(e.open)}>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content
              maxW="460px"
              bg="bg.surface"
              borderRadius="lg"
              border="1px solid"
              borderColor="border.default"
            >
              <Dialog.Header px={6} py={4} borderBottom="1px solid" borderColor="border.default">
                <Dialog.Title fontWeight="700" fontSize="xl" fontFamily="mono">Reset Tutorial & Other Modes</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body px={6} py={5}>
                <Text fontSize="sm" lineHeight="1.6" fontFamily="mono">
                  This will delete all files in tutorial and other modes (internals, etc.) and restore their original template documents.
                  Any questions, dashboards, or conversations created in those modes will be permanently lost.
                </Text>
              </Dialog.Body>
              <Dialog.Footer px={6} py={4} gap={3} borderTop="1px solid" borderColor="border.default" justifyContent="flex-end">
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline" fontFamily="mono" onClick={() => setShowResetTutorialConfirm(false)}>
                    Cancel
                  </Button>
                </Dialog.ActionTrigger>
                <Button colorPalette="red" fontFamily="mono" onClick={handleResetTutorial}>
                  Reset
                </Button>
              </Dialog.Footer>
              <Dialog.CloseTrigger />
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

    </Box>
  );
}
