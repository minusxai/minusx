'use client';

/**
 * ContextContainer V2 - With Version Management
 * Smart component using Core Patterns with useFile hook and filesSlice
 * Adds version management for admins
 */
import { useAppSelector } from '@/store/hooks';
import { selectIsDirty, selectEffectiveName, type FileId } from '@/store/filesSlice';
import { useFile } from '@/lib/hooks/file-state-hooks';
import { editFile, publishFile, clearFileChanges, reloadFile } from '@/lib/api/file-state';
import ContextEditorV2 from '@/components/context/ContextEditorV2';
import { ContextContent, ContextVersion, DocEntry } from '@/lib/types';
import { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { useRouter } from '@/lib/navigation/use-navigation';
import { redirectAfterSave } from '@/lib/ui/file-utils';
import { isUserFacingError } from '@/lib/errors';
import { Dialog, Portal, Button, Text } from '@chakra-ui/react';
import { type FileViewMode } from '@/lib/ui/fileComponents';
import {
  validateContextVersions,
  canDeleteVersion,
  getNextVersionNumber,
  getPublishedVersionForUser
} from '@/lib/context/context-utils';

interface ContextContainerV2Props {
  fileId: FileId;
  mode?: FileViewMode;
  defaultFolder?: string;
}

/**
 * Smart component for context pages - With Version Management
 * Uses useFile hook for state management
 * Delegates rendering and domain logic to ContextEditor
 */
export default function ContextContainerV2({
  fileId,
  mode = 'view',
  defaultFolder = '/org',
}: ContextContainerV2Props) {
  const router = useRouter();

  // Get current user for version management
  const user = useAppSelector(state => state.auth.user);

  // Phase 2: Use useFile hook for state management
  const { fileState: file } = useFile(fileId) ?? {};
  const fileLoading = !file || file.loading;
  const saving = file?.saving ?? false;
  const error = file?.loadError ?? null;
  const isDirty = useAppSelector(state => selectIsDirty(state, fileId));

  // Phase 5: Get effective name (with pending metadata changes)
  const effectiveName = useAppSelector(state => selectEffectiveName(state, fileId)) || '';

  // Save error state (for user-facing errors)
  const [saveError, setSaveError] = useState<string | null>(null);

  // Edit mode state (controlled by container)
  const [editMode, setEditMode] = useState(mode === 'create');

  // Handler for edit mode changes
  const handleEditModeChange = useCallback((newMode: boolean) => {
    setEditMode(newMode);
  }, []);

  // Automatically enter edit mode when file becomes dirty
  useEffect(() => {
    if (isDirty && !editMode) {
      handleEditModeChange(true);
    }
  }, [isDirty, editMode, handleEditModeChange]);

  // Background refresh for context files (multi-user collaboration)
  // Track per-file to avoid re-fetching when navigating between contexts
  const hasBackgroundRefreshed = useRef<Record<number, boolean>>({});

  useEffect(() => {
    // Skip if: File not loaded yet, already refreshed this file, or user editing
    if (!file?.content || hasBackgroundRefreshed.current[fileId] || isDirty) {
      return;
    }

    // Mark this file as refreshed
    hasBackgroundRefreshed.current[fileId] = true;

    // Silent background refresh (skipLoading = true)
    if (typeof fileId === 'number') {
      reloadFile({ fileId, silent: true });
    }
  }, [file?.content, fileId, isDirty]);

  // Merge content with persistableChanges for preview
  const currentContent = useMemo(() => {
    if (!file) return null;

    const merged = {
      ...file.content,
      ...file.persistableChanges
    } as ContextContent;

    // Auto-migrate legacy contexts without versions (safety net)
    if (!merged.versions || merged.versions.length === 0) {
      // Legacy format: has top-level databases and docs
      if (merged.databases !== undefined) {
        const now = new Date().toISOString();
        return {
          ...merged,
          versions: [{
            version: 1,
            databases: merged.databases || [],
            docs: merged.docs || [],
            createdAt: now,
            createdBy: user?.id || 1,
            description: 'Migrated from legacy format'
          }],
          published: { all: 1 }
        };
      }

      // Invalid state - create minimal valid structure
      console.error('Context has no versions and no legacy format. Creating minimal version 1.');
      const now = new Date().toISOString();
      return {
        ...merged,
        versions: [{
          version: 1,
          databases: [],
          docs: [],
          createdAt: now,
          createdBy: user?.id || 1,
          description: 'Created from invalid state'
        }],
        published: { all: 1 },
        fullSchema: merged.fullSchema || [],
        fullDocs: merged.fullDocs || []
      };
    }

    return merged;
  }, [file, user]);

  // Track selected version (defaults to user's published version)
  // Initialize once on mount, don't reset after edits/saves
  const [selectedVersion, setSelectedVersion] = useState<number>(() => {
    if (!currentContent || !currentContent.versions || !user?.id) return 1;
    return getPublishedVersionForUser(currentContent, user.id);
  });

  // Get the currently selected version content
  const currentVersionContent = useMemo(() => {
    if (!currentContent || !currentContent.versions) return null;
    return currentContent.versions.find(v => v.version === selectedVersion);
  }, [currentContent, selectedVersion]);

  // State for unsaved changes confirmation modal
  const [isUnsavedChangesOpen, setIsUnsavedChangesOpen] = useState(false);
  const [pendingVersionSwitch, setPendingVersionSwitch] = useState<number | null>(null);

  // Handle version switching
  const handleSwitchVersion = useCallback((version: number) => {
    if (isDirty) {
      setPendingVersionSwitch(version);
      setIsUnsavedChangesOpen(true);
      return;
    }
    setSelectedVersion(version);
  }, [isDirty]);

  // Confirm version switch despite unsaved changes
  const handleConfirmVersionSwitch = useCallback(() => {
    if (pendingVersionSwitch !== null) {
      setSelectedVersion(pendingVersionSwitch);
    }
    setIsUnsavedChangesOpen(false);
    setPendingVersionSwitch(null);
  }, [pendingVersionSwitch]);

  // Handle creating new version
  const handleCreateVersion = useCallback((description?: string) => {
    if (!currentContent || !user?.id) return;

    // Get source version (currently selected)
    const sourceVersion = currentContent.versions?.find(v => v.version === selectedVersion);
    if (!sourceVersion) {
      throw new Error('Source version not found');
    }

    const newVersionNumber = getNextVersionNumber(currentContent);

    const newVersion: ContextVersion = {
      version: newVersionNumber,
      databases: JSON.parse(JSON.stringify(sourceVersion.databases)),  // Deep copy
      docs: sourceVersion.docs.map((doc: DocEntry) => ({ ...doc, childPaths: doc.childPaths ? [...doc.childPaths] : undefined })),
      createdAt: new Date().toISOString(),
      createdBy: user.id,
      description: description || ''
    };

    const updatedVersions = [...(currentContent.versions || []), newVersion];

    // Update content with new version
    editFile({ fileId: typeof fileId === 'number' ? fileId : -1, changes: { content: { ...currentContent, versions: updatedVersions } as ContextContent } });

    // Switch to the new version
    setSelectedVersion(newVersionNumber);
  }, [currentContent, selectedVersion, user, fileId]);

  // Handle publishing version (only publish to all)
  const handlePublishVersion = useCallback(() => {
    if (!currentContent) return;

    // Update content with new published state
    editFile({ fileId: typeof fileId === 'number' ? fileId : -1, changes: { content: { ...currentContent, published: { all: selectedVersion } } as ContextContent } });
  }, [currentContent, selectedVersion, fileId]);


  // Handle deleting version
  const handleDeleteVersion = useCallback((version: number) => {
    if (!currentContent || !user?.id) return;

    // Validate deletion
    if (!canDeleteVersion(currentContent, version)) {
      throw new Error('Cannot delete this version (only version or published)');
    }

    const updatedVersions = currentContent.versions?.filter(v => v.version !== version);

    // Update content
    editFile({ fileId: typeof fileId === 'number' ? fileId : -1, changes: { content: { ...currentContent, versions: updatedVersions } as ContextContent } });

    // Switch to published version if deleted current
    if (selectedVersion === version) {
      const newContent = { ...currentContent, versions: updatedVersions };
      const publishedVersion = getPublishedVersionForUser(newContent, user.id);
      setSelectedVersion(publishedVersion);
    }
  }, [currentContent, selectedVersion, user?.id, fileId]);

  // Handle updating version description
  const handleUpdateDescription = useCallback((version: number, description: string) => {
    if (!currentContent) return;

    const updatedVersions = currentContent.versions?.map(v => {
      if (v.version === version) {
        return { ...v, description };
      }
      return v;
    });

    editFile({ fileId: typeof fileId === 'number' ? fileId : -1, changes: { content: { ...currentContent, versions: updatedVersions } as ContextContent } });
  }, [currentContent, fileId]);

  // Phase 5: Metadata change handler
  const handleMetadataChange = useCallback((changes: { name?: string }) => {
    editFile({ fileId: typeof fileId === 'number' ? fileId : -1, changes });
  }, [fileId]);

  // Handle saving with validation
  const handleSave = useCallback(async () => {
    if (!currentContent) return;

    // Clear previous save error
    setSaveError(null);

    // Validate versions structure
    try {
      validateContextVersions(currentContent);
    } catch (err) {
      console.error('Validation failed:', err);
      setSaveError(err instanceof Error ? err.message : 'Validation failed');
      return;
    }

    try {
      if (typeof fileId === 'number') {
        const result = await publishFile({ fileId });
        redirectAfterSave(result, fileId, router);
      }
    } catch (error) {
      // User-facing errors should be shown in UI
      if (isUserFacingError(error)) {
        setSaveError(error.message);
        return; // Don't re-throw
      }

      // Internal errors should be logged
      console.error('Failed to save context:', error);
      setSaveError('An unexpected error occurred. Please try again.');
    }
  }, [currentContent, fileId, router]);

  // Cancel handler - discard local changes without reloading
  const handleCancel = useCallback(() => {
    if (typeof fileId === 'number') {
      clearFileChanges({ fileId });
    }
    setEditMode(false);
    setSaveError(null);
  }, [fileId]);

  // Show loading state while file is loading
  if (fileLoading || !file || !currentContent) {
    return <div>Loading context...</div>;
  }

  // Handle changes from editor (for the selected version)
  const handleChange = useCallback((updates: Partial<ContextContent>) => {
    if (!currentContent || !currentVersionContent || !user?.id) return;

    // If updating databases or docs, update the selected version
    if (updates.databases !== undefined || updates.docs !== undefined) {
      const updatedVersions = currentContent.versions?.map(v => {
        if (v.version === selectedVersion) {
          return {
            ...v,
            databases: updates.databases ?? v.databases,
            docs: updates.docs ?? v.docs,
            lastEditedAt: new Date().toISOString(),
            lastEditedBy: user.id
          };
        }
        return v;
      });

      editFile({ fileId: typeof fileId === 'number' ? fileId : -1, changes: { content: { ...currentContent, versions: updatedVersions } as ContextContent } });
    } else {
      // Other updates go through directly
      editFile({ fileId: typeof fileId === 'number' ? fileId : -1, changes: { content: { ...currentContent, ...updates } as ContextContent } });
    }
  }, [currentContent, currentVersionContent, selectedVersion, user?.id, fileId]);

  // Build content for editor (includes selected version's data)
  const editorContent = useMemo((): ContextContent => {
    if (!currentContent || !currentVersionContent) {
      return currentContent || {
        versions: [],
        published: { all: 1 },
        fullSchema: [],
        fullDocs: []
      };
    }

    return {
      ...currentContent,
      // Expose selected version's databases/docs for editing
      databases: currentVersionContent.databases,
      docs: currentVersionContent.docs,
      published: currentContent.published // Ensure published is always present
    };
  }, [currentContent, currentVersionContent]);

  return (
    <>
      <ContextEditorV2
        content={editorContent}
        fileName={effectiveName}
        isDirty={isDirty}
        isSaving={saving}
        saveError={saveError}
        editMode={editMode}
        onChange={handleChange}
        onMetadataChange={handleMetadataChange}
        onSave={handleSave}
        onCancel={handleCancel}
        onEditModeChange={handleEditModeChange}
        file={file ? { id: file.id, path: file.path, type: file.type } : undefined}
        // Version management props (admin only)
        isAdmin={user?.role === 'admin'}
        userId={user?.id}
        currentVersion={selectedVersion}
        allVersions={currentContent.versions || []}
        publishedStatus={currentContent.published}
        onSwitchVersion={handleSwitchVersion}
        onCreateVersion={handleCreateVersion}
        onPublishVersion={handlePublishVersion}
        onDeleteVersion={handleDeleteVersion}
        onUpdateDescription={handleUpdateDescription}
      />

      {/* Unsaved Changes Confirmation Dialog */}
      <Dialog.Root open={isUnsavedChangesOpen} onOpenChange={(e: { open: boolean }) => setIsUnsavedChangesOpen(e.open)}>
        <Portal>
          <Dialog.Backdrop />
          <Dialog.Positioner>
            <Dialog.Content
              maxW="500px"
              bg="bg.surface"
              borderRadius="lg"
              border="1px solid"
              borderColor="border.default"
            >
              <Dialog.Header px={6} py={4} borderBottom="1px solid" borderColor="border.default">
                <Dialog.Title fontWeight="700" fontSize="xl">Unsaved Changes</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body px={6} py={5}>
                <Text fontSize="sm" lineHeight="1.6">
                  You have unsaved changes. Are you sure you want to switch versions? Your changes will be lost.
                </Text>
              </Dialog.Body>
              <Dialog.Footer px={6} py={4} gap={3} borderTop="1px solid" borderColor="border.default" justifyContent="flex-end">
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline" onClick={() => setIsUnsavedChangesOpen(false)}>
                    Cancel
                  </Button>
                </Dialog.ActionTrigger>
                <Button bg="accent.warning/70" color="white" onClick={handleConfirmVersionSwitch}>
                  Switch Anyway
                </Button>
              </Dialog.Footer>
              <Dialog.CloseTrigger />
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </>
  );
}
