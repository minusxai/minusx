'use client';

import { useState, useEffect } from 'react';
import { Box, Flex, Text, Button, Input, VStack, Icon } from '@chakra-ui/react';
import { LuDownload, LuUpload, LuCircleCheck, LuCircleX, LuLoader, LuChevronDown, LuChevronRight } from 'react-icons/lu';
import { fetchWithCache } from '@/lib/api/fetch-wrapper';
import { API } from '@/lib/api/declarations';

interface ValidationStatus {
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

interface MigrationResult {
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
          if (currentVersion !== null && parsedData.version !== currentVersion) {
            setImportStatus({
              valid: false,
              errors: [
                `Version mismatch: File is v${parsedData.version}, current DB is v${currentVersion}`,
                'Please use CLI tools for migrations'
              ],
              warnings: []
            });
            event.target.value = '';
            return;
          }

          // Basic structure validation (V2 format check)
          const hasV2Structure = parsedData.companies && Array.isArray(parsedData.companies) && parsedData.companies.length > 0;
          const firstCompany = parsedData.companies?.[0];
          const isV2Format = firstCompany && ('users' in firstCompany || 'documents' in firstCompany);

          if (!hasV2Structure) {
            throw new Error('Invalid data structure: missing companies array');
          }

          if (!isV2Format) {
            throw new Error('Invalid data format: expected V2 format (nested companies)');
          }

          // Validate exactly 1 company for web UI
          if (parsedData.companies.length !== 1) {
            setImportStatus({
              valid: false,
              errors: [
                `File must contain exactly 1 company (found ${parsedData.companies.length})`,
                'Web UI only supports single-company imports. Use CLI for multi-company imports.'
              ],
              warnings: []
            });
            event.target.value = '';
            return;
          }

          const company = parsedData.companies[0];
          setUploadedData(parsedData);
          setUploadedFile(file);

          // Show ready to import with company details
          setImportStatus({
            valid: true,
            errors: [],
            warnings: [
              `${company.display_name}: ${company.users.length} users, ${company.documents.length} documents`,
              '⚠ This will OVERWRITE your current company data'
            ]
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
      const response = await fetch('/api/admin/import-company', {
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
        errors: ['Failed to import company data'],
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

  const renderStatusWithErrors = (
    status: ValidationStatus | null,
    type: 'export' | 'validate' | 'import'
  ) => {
    if (!status) return null;

    return (
      <Box mt={2}>
        <Flex
          align="center"
          gap={2}
          cursor={status.errors.length > 0 ? 'pointer' : 'default'}
          onClick={() => status.errors.length > 0 && setExpandedErrors(expandedErrors === type ? null : type)}
        >
          <Text fontSize="xs" color={status.valid ? 'accent.teal' : 'accent.danger'} fontFamily="mono">
            {status.valid
              ? (status.warnings.length > 0 ? status.warnings[0] : '✓ Valid')
              : `✗ ${status.errors.length} error${status.errors.length > 1 ? 's' : ''}`}
          </Text>
          {status.errors.length > 0 && (
            <Icon fontSize="sm" color="fg.muted">
              {expandedErrors === type ? <LuChevronDown /> : <LuChevronRight />}
            </Icon>
          )}
        </Flex>

        {status.errors.length > 0 && expandedErrors === type && (
          <Box mt={2} p={2} bg="accent.danger" borderRadius="md" borderWidth="1px" borderColor="accent.danger">
            <VStack align="stretch" gap={1}>
              {status.errors.map((error, idx) => (
                <Text key={idx} fontSize="xs" color="accent.danger" fontFamily="mono">
                  • {error}
                </Text>
              ))}
            </VStack>
          </Box>
        )}
      </Box>
    );
  };

  const renderMigrationStatus = (result: MigrationResult | null) => {
    if (!result) return null;

    return (
      <Box mt={2}>
        <Flex
          align="center"
          gap={2}
          cursor={result.errors && result.errors.length > 0 ? 'pointer' : 'default'}
          onClick={() => result.errors && result.errors.length > 0 && setExpandedErrors(expandedErrors === 'migrate' ? null : 'migrate')}
        >
          <Text fontSize="xs" color={result.success ? 'accent.teal' : 'accent.danger'} fontFamily="mono">
            {result.success
              ? (result.migrations.length > 0
                  ? `✓ ${result.migrations.length} migration${result.migrations.length > 1 ? 's' : ''} applied`
                  : result.message || '✓ Database is up to date')
              : `✗ ${result.errors?.length || 0} error${(result.errors?.length || 0) > 1 ? 's' : ''}`}
          </Text>
          {result.errors && result.errors.length > 0 && (
            <Icon fontSize="sm" color="fg.muted">
              {expandedErrors === 'migrate' ? <LuChevronDown /> : <LuChevronRight />}
            </Icon>
          )}
        </Flex>

        {/* Show applied migrations */}
        {result.success && result.migrations.length > 0 && (
          <Box mt={2} p={2} bg="accent.teal" borderRadius="md" borderWidth="1px" borderColor="accent.teal">
            <VStack align="stretch" gap={1}>
              {result.migrations.map((migration, idx) => (
                <Text key={idx} fontSize="xs" color="accent.teal" fontFamily="mono">
                  ✓ {migration}
                </Text>
              ))}
            </VStack>
          </Box>
        )}

        {/* Show errors */}
        {result.errors && result.errors.length > 0 && expandedErrors === 'migrate' && (
          <Box mt={2} p={2} bg="accent.danger" borderRadius="md" borderWidth="1px" borderColor="accent.danger">
            <VStack align="stretch" gap={1}>
              {result.errors.map((error, idx) => (
                <Text key={idx} fontSize="xs" color="accent.danger" fontFamily="mono">
                  • {error}
                </Text>
              ))}
            </VStack>
          </Box>
        )}

        {/* Show validation results if present */}
        {result.validation && result.validation.errors.length > 0 && (
          <Box mt={2} p={2} bg="orange.50" borderRadius="md" borderWidth="1px" borderColor="orange.200">
            <Text fontSize="xs" fontWeight="medium" color="orange.900" fontFamily="mono" mb={1}>
              Validation Issues:
            </Text>
            <VStack align="stretch" gap={1}>
              {result.validation.errors.map((error, idx) => (
                <Text key={idx} fontSize="xs" color="orange.900" fontFamily="mono">
                  • {error}
                </Text>
              ))}
            </VStack>
          </Box>
        )}
      </Box>
    );
  };

  return (
    <Box>
      <VStack align="stretch" gap={0} divideY="1px">
        {/* Export */}
        <Box py={4} px={4}>
          <Flex justify="space-between" align="center" mb={exportStatus ? 2 : 0}>
            <Text fontSize="sm" fontWeight="medium" fontFamily="mono">
              Export Company Data
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
            Export your company data to compressed JSON file (.json.gz)
          </Text>
          {renderStatusWithErrors(exportStatus, 'export')}
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

          {renderStatusWithErrors(validateStatus, 'validate')}
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
          {renderMigrationStatus(migrateStatus)}
        </Box>

        {/* Import */}
        <Box py={4} px={4}>
          <Flex justify="space-between" align="center" mb={2}>
            <Text fontSize="sm" fontWeight="medium" fontFamily="mono">
              Import Company Data
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
                    'Overwrite Company Data'
                  )}
                </Button>
              )}
            </Flex>
          </Flex>
          <VStack align="stretch" gap={1} mb={importStatus ? 2 : 0}>
            <Text fontSize="xs" color="fg.muted" fontFamily="mono">
              Import your company's data from a JSON file (.json or .json.gz)
            </Text>
            {currentVersion !== null && (
              <Text fontSize="xs" color="fg.muted" fontFamily="mono">
                Current database version: v{currentVersion} (only matching version allowed)
              </Text>
            )}
          </VStack>
          {renderStatusWithErrors(importStatus, 'import')}

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
                  Uploaded Data Preview ({uploadedData.companies?.length || 0} companies, {uploadedData.users?.length || 0} users, {uploadedData.documents?.length || 0} documents)
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
      </VStack>
    </Box>
  );
}
