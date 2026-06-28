'use client';

/**
 * SaveFileModal - "Save As" dialog for new (virtual) files.
 *
 * Shows a folder tree and name input. When saved, updates the virtual
 * file's name and path, then publishes it.
 */

import { useState, useMemo, useCallback } from 'react';
import { Dialog, Input, Button, VStack, HStack, Text, Box, Icon } from '@chakra-ui/react';
import { useStableCallback } from '@/lib/hooks/use-stable-callback';
import { LuFolder, LuFolderOpen, LuChevronRight, LuChevronDown } from 'react-icons/lu';
import { useFilesByCriteria } from '@/lib/hooks/file-state-hooks';
import { isUnderSystemFolder } from '@/lib/mode/path-resolver';
import { useAppSelector } from '@/store/hooks';
import { selectEffectiveName, selectMergedContent } from '@/store/filesSlice';
import { getFileTypeMetadata } from '@/lib/ui/file-metadata';
import { GenerateButton } from './ui/GenerateButton';
import { runMicroTaskClient, buildFileMicroInput } from '@/lib/api/micro-task';
import { hasGeneratableContent } from '@/lib/ui/file-utils';
import { toaster } from './ui/toaster';

// ---------------------------------------------------------------------------
// Tree data structure
// ---------------------------------------------------------------------------

interface TreeNode {
  path: string;
  name: string;
  children: TreeNode[];
}

function buildTree(paths: string[], rootPath: string): TreeNode {
  const root: TreeNode = { path: rootPath, name: 'Home', children: [] };
  const nodeMap = new Map<string, TreeNode>();
  nodeMap.set(rootPath, root);

  const sorted = Array.from(paths).sort();
  for (const path of sorted) {
    if (path === rootPath) continue;
    const parentPath = path.substring(0, path.lastIndexOf('/')) || '/';
    const name = path.substring(path.lastIndexOf('/') + 1);
    const node: TreeNode = { path, name, children: [] };
    nodeMap.set(path, node);

    const parent = nodeMap.get(parentPath);
    if (parent) {
      parent.children.push(node);
    }
  }

  return root;
}

// ---------------------------------------------------------------------------
// FolderTreeRow — single row in the tree
// ---------------------------------------------------------------------------

function FolderTreeRow({
  node,
  depth,
  isSelected,
  isExpanded,
  hasChildren,
  onSelect,
  onToggle,
}: {
  node: TreeNode;
  depth: number;
  isSelected: boolean;
  isExpanded: boolean;
  hasChildren: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  return (
    <HStack
      gap={0}
      py={1}
      px={2}
      pl={`${depth * 20 + 8}px`}
      cursor="pointer"
      bg={isSelected ? 'accent.primary/15' : 'transparent'}
      _hover={{ bg: isSelected ? 'accent.primary/20' : 'bg.muted' }}
      borderRadius="sm"
      onClick={onSelect}
      transition="background 0.1s"
    >
      {/* Expand/collapse arrow */}
      <Box
        w={4} h={4}
        display="flex"
        alignItems="center"
        justifyContent="center"
        flexShrink={0}
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        opacity={hasChildren ? 1 : 0}
        cursor={hasChildren ? 'pointer' : 'default'}
      >
        <Icon
          as={isExpanded ? LuChevronDown : LuChevronRight}
          boxSize={3}
          color="fg.subtle"
        />
      </Box>

      {/* Folder icon */}
      <Icon
        as={isExpanded ? LuFolderOpen : LuFolder}
        boxSize={3.5}
        color={isSelected ? 'accent.primary' : 'fg.muted'}
        mr={1.5}
        flexShrink={0}
      />

      {/* Folder name */}
      <Text
        fontSize="xs"
        fontFamily="mono"
        fontWeight={isSelected ? '600' : '500'}
        color={isSelected ? 'accent.primary' : 'fg.default'}
        truncate
      >
        {node.name}
      </Text>
    </HStack>
  );
}

// ---------------------------------------------------------------------------
// FolderTree — recursive tree renderer
// ---------------------------------------------------------------------------

function FolderTree({
  node,
  depth,
  selectedPath,
  expanded,
  onSelect,
  onToggle,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string;
  expanded: Set<string>;
  onSelect: (path: string) => void;
  onToggle: (path: string) => void;
}) {
  const isSelected = node.path === selectedPath;
  const isExpanded = expanded.has(node.path);
  const hasChildren = node.children.length > 0;

  return (
    <>
      <FolderTreeRow
        node={node}
        depth={depth}
        isSelected={isSelected}
        isExpanded={isExpanded}
        hasChildren={hasChildren}
        onSelect={() => onSelect(node.path)}
        onToggle={() => onToggle(node.path)}
      />
      {isExpanded && node.children.map(child => (
        <FolderTree
          key={child.path}
          node={child}
          depth={depth + 1}
          selectedPath={selectedPath}
          expanded={expanded}
          onSelect={onSelect}
          onToggle={onToggle}
        />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// SaveFileModal
// ---------------------------------------------------------------------------

interface SaveFileModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileId: number;
  fileType: string;
  /** Called with { name, path } when user confirms. Caller handles the actual save. */
  onSave: (name: string, path: string) => void;
  defaultPath?: string;
}

export default function SaveFileModal({ isOpen, onClose, fileId, fileType, onSave, defaultPath }: SaveFileModalProps) {
  const mode = useAppSelector(state => state.auth.user?.mode ?? 'org');
  const currentName = useAppSelector(state => selectEffectiveName(state, fileId)) ?? '';
  const mergedContent = useAppSelector(state => selectMergedContent(state, fileId));
  const canGenerate = hasGeneratableContent(fileType, mergedContent);
  const metadata = getFileTypeMetadata(fileType as any);
  const rootPath = `/${mode}`;

  const [fileName, setFileName] = useState(currentName);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState(defaultPath ?? rootPath);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Auto-expand the path to the default folder
    const initial = new Set<string>();
    const target = defaultPath ?? rootPath;
    const parts = target.split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i++) {
      initial.add('/' + parts.slice(0, i).join('/'));
    }
    return initial;
  });

  // Load all folders
  const { files: folderFiles } = useFilesByCriteria({
    criteria: { type: 'folder' },
    skip: !isOpen,
    partial: true,
  });

  // Build folder paths set (including implicit parents)
  const allFolderPaths = useMemo(() => {
    const paths = new Set<string>();
    paths.add(rootPath);
    folderFiles.forEach(file => {
      if (isUnderSystemFolder(file.path, mode)) return;
      paths.add(file.path);
      const pathParts = file.path.split('/').filter(Boolean);
      for (let i = 1; i <= pathParts.length - 1; i++) {
        const parentPath = '/' + pathParts.slice(0, i).join('/');
        if (!isUnderSystemFolder(parentPath, mode)) {
          paths.add(parentPath);
        }
      }
    });
    return paths;
  }, [folderFiles, mode, rootPath]);

  // Build tree from flat paths
  const tree = useMemo(() => buildTree(Array.from(allFolderPaths), rootPath), [allFolderPaths, rootPath]);

  const handleToggle = useCallback((path: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleSelect = useCallback((path: string) => {
    setSelectedFolder(path);
    // Auto-expand when selecting
    setExpanded(prev => {
      const next = new Set(prev);
      next.add(path);
      return next;
    });
  }, []);

  const handleSuggestName = useCallback(async () => {
    setIsSuggesting(true);
    try {
      // Generate from the file being saved — its current (unsaved) content.
      const name = await runMicroTaskClient('title', {
        input: buildFileMicroInput(fileId),
        subject: `a ${fileType}`,
        instructions: '',
      });
      setFileName(name);
    } catch (err) {
      console.error('[SaveFileModal] failed to suggest a name:', err);
      toaster.create({ title: "Couldn't suggest a name", description: 'Please try again.', type: 'error' });
    } finally {
      setIsSuggesting(false);
    }
  }, [fileId, fileType]);

  const handleSave = () => {
    const trimmed = fileName.trim();
    if (!trimmed) return;
    onSave(trimmed, selectedFolder);
    onClose();
  };

  const handleClose = () => {
    onClose();
  };
  // Stable identity to keep Dialog.Root from churning on parent re-renders.
  const handleOpenChange = useStableCallback((e: { open: boolean }) => { if (!e.open) handleClose(); });

  return (
    <Dialog.Root open={isOpen} onOpenChange={handleOpenChange} placement="center">
      <Dialog.Backdrop />
      <Dialog.Positioner>
        <Dialog.Content
          w="560px"
          maxW="90vw"
          p={0}
          borderRadius="xl"
          bg="bg.surface"
          overflow="hidden"
          shadow="xl"
        >
          <Dialog.Header px={6} pt={5} pb={0}>
            <Dialog.Title fontSize="md" fontWeight="700" fontFamily="mono">
              Save {metadata.label}
            </Dialog.Title>
          </Dialog.Header>

          <Dialog.Body px={6} py={4}>
            <VStack align="stretch" gap={5}>
              {/* Name input */}
              <Box>
                <Text fontSize="xs" fontWeight="600" color="fg.muted" mb={2}>Name</Text>
                <HStack gap={2} align="center">
                  <Input
                    aria-label="File name"
                    value={fileName}
                    onChange={(e) => setFileName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
                    placeholder={`Enter ${metadata.label.toLowerCase()} name`}
                    size="md"
                    fontFamily="mono"
                    flex="1"
                    autoFocus
                  />
                  {!fileName.trim() && canGenerate && (
                    <GenerateButton label="Suggest a name" loading={isSuggesting} onClick={handleSuggestName} />
                  )}
                </HStack>
              </Box>

              {/* Folder tree */}
              <Box>
                <Text fontSize="xs" fontWeight="600" color="fg.muted" mb={2}>Save to</Text>
                <Box
                  border="1px solid"
                  borderColor="border.default"
                  borderRadius="lg"
                  h="280px"
                  overflowY="auto"
                  py={1.5}
                  bg="bg.subtle"
                >
                  <FolderTree
                    node={tree}
                    depth={0}
                    selectedPath={selectedFolder}
                    expanded={expanded}
                    onSelect={handleSelect}
                    onToggle={handleToggle}
                  />
                </Box>

                {/* Selected path preview */}
                <HStack mt={2} gap={1.5} px={1}>
                  <Text fontSize="2xs" fontWeight="600" color="fg.subtle" flexShrink={0}>Path:</Text>
                  <Text fontSize="2xs" color="fg.muted" fontFamily="mono" truncate>
                    {selectedFolder}/{fileName.trim() ? fileName.trim().toLowerCase().replace(/\s+/g, '-') : '...'}
                  </Text>
                </HStack>
              </Box>
            </VStack>
          </Dialog.Body>

          <Dialog.Footer px={6} pb={5} pt={0}>
            <HStack gap={2} justify="flex-end" w="100%">
              <Button variant="ghost" size="sm" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                aria-label="Confirm save"
                size="sm"
                bg="accent.teal"
                color="white"
                _hover={{ opacity: 0.9 }}
                onClick={handleSave}
                disabled={!fileName.trim()}
              >
                Save
              </Button>
            </HStack>
          </Dialog.Footer>

          <Dialog.CloseTrigger />
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Root>
  );
}
