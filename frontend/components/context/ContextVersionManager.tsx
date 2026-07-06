'use client';

/**
 * ContextVersionManager - version selector banner + create/delete/delete-error
 * dialogs (admin only, behind the debug toggle).
 * Extracted from ContextEditorV2 — pure structural move, no behavior change.
 */

import { HStack, Button, Text, Badge, Menu, Input, Dialog, Field, Portal } from '@chakra-ui/react';
import { useState } from 'react';
import { LuCircleCheck, LuPlus, LuTrash2, LuChevronDown, LuGlobe } from 'react-icons/lu';
import type { ContextContent, ContextVersion, PublishedVersions } from '@/lib/types';
import { canDeleteVersion } from '@/lib/context/context-utils';

interface ContextVersionManagerProps {
  content: ContextContent;
  showDebug: boolean;
  isAdmin: boolean;
  currentVersion: number;
  allVersions: ContextVersion[];
  publishedStatus: PublishedVersions;
  isDirty: boolean;
  onSwitchVersion?: (version: number) => void;
  onCreateVersion?: (description?: string) => void;
  onPublishVersion?: () => void;
  onDeleteVersion?: (version: number) => void;
}

export function ContextVersionManager({
  content,
  showDebug,
  isAdmin,
  currentVersion,
  allVersions,
  publishedStatus,
  isDirty,
  onSwitchVersion,
  onCreateVersion,
  onPublishVersion,
  onDeleteVersion,
}: ContextVersionManagerProps) {
  // Version management state
  const [isCreateVersionOpen, setIsCreateVersionOpen] = useState(false);
  const [newVersionDescription, setNewVersionDescription] = useState('');
  const [isDeleteVersionOpen, setIsDeleteVersionOpen] = useState(false);
  const [versionToDelete, setVersionToDelete] = useState<number | null>(null);
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null);

  // Version management helpers
  const getVersionLabel = (version: ContextVersion) => {
    const labels: string[] = [`Version ${version.version}`];

    if (publishedStatus.all === version.version) {
      labels.push('Published');
    }

    return labels.join(' • ');
  };

  const handleCreateVersionClick = () => {
    setNewVersionDescription('');
    setIsCreateVersionOpen(true);
  };

  const handleCreateVersionConfirm = () => {
    if (onCreateVersion) {
      onCreateVersion(newVersionDescription);
    }
    setIsCreateVersionOpen(false);
  };

  const handleDeleteVersionClick = (version: number) => {
    if (!canDeleteVersion(content, version)) {
      setDeleteErrorMessage('Cannot delete this version: it is either the only version or is currently published.');
      return;
    }

    setVersionToDelete(version);
    setIsDeleteVersionOpen(true);
  };

  const handleDeleteVersionConfirm = () => {
    if (versionToDelete !== null && onDeleteVersion) {
      onDeleteVersion(versionToDelete);
    }
    setIsDeleteVersionOpen(false);
    setVersionToDelete(null);
  };

  return (
    <>
      {/* Version Management (Admin Only, behind debug toggle) */}
      {showDebug && isAdmin && allVersions.length > 0 && (
        <HStack justify="space-between" px={3} py={2} bg="bg.muted" borderRadius="md">
          <HStack gap={3}>
            <Text fontSize="sm" fontWeight="600" color="fg.muted">
              Version:
            </Text>
            <Menu.Root>
              <Menu.Trigger asChild>
                <Button size="xs" variant="outline">
                  {getVersionLabel(allVersions.find(v => v.version === currentVersion)!)}
                  <LuChevronDown />
                </Button>
              </Menu.Trigger>
              <Portal>
                <Menu.Positioner>
                  <Menu.Content>
                    {allVersions.map(version => (
                      <Menu.Item
                        key={version.version}
                        value={version.version.toString()}
                        onClick={() => onSwitchVersion?.(version.version)}
                      >
                        <HStack justify="space-between" width="100%">
                          <Text>{getVersionLabel(version)}</Text>
                          {publishedStatus.all === version.version && (
                            <Badge size="xs" colorPalette="green">
                              <LuCircleCheck /> Published
                            </Badge>
                          )}
                        </HStack>
                      </Menu.Item>
                    ))}
                  </Menu.Content>
                </Menu.Positioner>
              </Portal>
            </Menu.Root>
            {allVersions.find(v => v.version === currentVersion)?.description && (
              <Text fontSize="xs" color="fg.muted">
                — {allVersions.find(v => v.version === currentVersion)!.description}
              </Text>
            )}
          </HStack>

          {/* Version Actions */}
          <HStack gap={2}>
            <Button
              size="xs"
              variant="outline"
              onClick={handleCreateVersionClick}
            >
              <LuPlus />
              New Version
            </Button>

            {/* Show publish button if not already published */}
            {publishedStatus.all !== currentVersion && (
              <Button
                size="xs"
                variant="outline"
                disabled={isDirty}
                onClick={onPublishVersion}
              >
                <LuGlobe />
                Publish
              </Button>
            )}

            {allVersions.length > 1 && canDeleteVersion(content, currentVersion) && (
              <Button
                size="xs"
                variant="outline"
                colorPalette="red"
                onClick={() => handleDeleteVersionClick(currentVersion)}
              >
                <LuTrash2 />
              </Button>
            )}
          </HStack>
        </HStack>
      )}

      {/* Create Version Dialog */}
      <Dialog.Root open={isCreateVersionOpen} onOpenChange={(e: { open: boolean }) => setIsCreateVersionOpen(e.open)}>
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
                <Dialog.Title fontWeight="700" fontSize="xl">Create New Version</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body px={6} py={5}>
                <Field.Root>
                  <Field.Label>Description (optional)</Field.Label>
                  <Input
                    value={newVersionDescription}
                    onChange={(e) => setNewVersionDescription(e.target.value)}
                    placeholder="e.g., Added marketing tables"
                  />
                </Field.Root>
              </Dialog.Body>
              <Dialog.Footer px={6} py={4} gap={3} borderTop="1px solid" borderColor="border.default" justifyContent="flex-end">
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline" onClick={() => setIsCreateVersionOpen(false)}>
                    Cancel
                  </Button>
                </Dialog.ActionTrigger>
                <Button bg="accent.cyan" color="white" onClick={handleCreateVersionConfirm}>
                  Create Version
                </Button>
              </Dialog.Footer>
              <Dialog.CloseTrigger />
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

      {/* Delete Version Confirmation Dialog */}
      <Dialog.Root open={isDeleteVersionOpen} onOpenChange={(e: { open: boolean }) => setIsDeleteVersionOpen(e.open)}>
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
                <Dialog.Title fontWeight="700" fontSize="xl">Delete Version</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body px={6} py={5}>
                <Text fontSize="sm" lineHeight="1.6">
                  Are you sure you want to delete <Text as="span" fontWeight="600" fontFamily="mono">Version {versionToDelete}</Text>? This action cannot be undone.
                </Text>
              </Dialog.Body>
              <Dialog.Footer px={6} py={4} gap={3} borderTop="1px solid" borderColor="border.default" justifyContent="flex-end">
                <Dialog.ActionTrigger asChild>
                  <Button variant="outline" onClick={() => setIsDeleteVersionOpen(false)}>
                    Cancel
                  </Button>
                </Dialog.ActionTrigger>
                <Button bg="accent.danger" color="white" onClick={handleDeleteVersionConfirm}>
                  Delete Version
                </Button>
              </Dialog.Footer>
              <Dialog.CloseTrigger />
            </Dialog.Content>
          </Dialog.Positioner>
        </Portal>
      </Dialog.Root>

      {/* Delete Error Dialog */}
      <Dialog.Root open={deleteErrorMessage !== null} onOpenChange={(e: { open: boolean }) => !e.open && setDeleteErrorMessage(null)}>
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
                <Dialog.Title fontWeight="700" fontSize="xl">Cannot Delete Version</Dialog.Title>
              </Dialog.Header>
              <Dialog.Body px={6} py={5}>
                <Text fontSize="sm" lineHeight="1.6">
                  {deleteErrorMessage}
                </Text>
              </Dialog.Body>
              <Dialog.Footer px={6} py={4} gap={3} borderTop="1px solid" borderColor="border.default" justifyContent="flex-end">
                <Button variant="outline" onClick={() => setDeleteErrorMessage(null)}>
                  OK
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
