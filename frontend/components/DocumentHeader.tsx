'use client';

import { ReactNode, useState, useCallback } from 'react';
import {
  Box,
  Heading,
  Text,
  Input,
  IconButton,
  HStack,
  VStack,
} from '@chakra-ui/react';
import { LuSave, LuPencil, LuTriangleAlert, LuEye, LuCode, LuUpload } from 'react-icons/lu';
import { getFileTypeMetadata, isSystemFileType, type FileType } from '@/lib/ui/file-metadata';
import TabSwitcher from './TabSwitcher';
import FileTypeBadge from './FileTypeBadge';
import ExplainButton from '@/components/ExplainButton';
import { useAppSelector } from '@/store/hooks';

// Default placeholder values that should be treated as empty
const DEFAULT_PLACEHOLDERS: Record<string, { name: string; description: string }> = {
  question: { name: 'New Question', description: 'Helpful description about this question.' },
  dashboard: { name: 'New Dashboard', description: 'Helpful description about this dashboard.' },
  notebook: { name: 'New Notebook', description: 'Helpful description about this notebook.' },
  presentation: { name: 'New Presentation', description: 'Helpful description about this presentation.' },
  report: { name: 'New Report', description: 'Helpful description about this report.' },
  alert: { name: 'New Alert', description: 'Helpful description about this alert.' },
  context: { name: 'New Knowledge Base', description: 'Helpful description about this knowledge base.' },
};

export interface DocumentHeaderProps {
  // Content
  name: string;
  description?: string;
  fileType: 'question' | 'dashboard' | 'notebook' | 'presentation' | 'report' | 'context' | 'alert';

  // State
  editMode: boolean;
  isDirty: boolean;
  isSaving: boolean;
  saveError?: string | null;

  // Handlers
  onNameChange: (name: string) => void;
  onDescriptionChange: (description: string) => void;
  onEditModeToggle: () => void;
  onSave: () => void;

  // Optional customization
  additionalBadges?: ReactNode;  // Additional badges to show next to type badge
  readOnlyName?: boolean;        // If true, name cannot be edited
  hideDescription?: boolean;     // If true, description field is not shown

  // JSON view toggle (optional - shown only for admins when provided)
  viewMode?: 'visual' | 'json';  // Current view mode
  onViewModeChange?: (mode: 'visual' | 'json') => void;  // View mode change handler

  // Explain button (optional - shown for questions)
  questionId?: number;  // If provided, show explain button in view mode

  // Publish workflow: when onPublish is provided and this is not a system file,
  // the Save button is replaced with a Publish button that opens the PublishModal.
  // System files (connection, config, styles, context) always use the inline Save button.
  onPublish?: () => void;

  // True when any file in the app has unsaved changes (not just this file).
  // Keeps the Publish button visible even when not editing the current file,
  // so it acts as a persistent reminder of unpublished work.
  anyDirtyFiles?: boolean;
}

export default function DocumentHeader({
  name,
  description,
  fileType,
  editMode,
  isDirty,
  isSaving,
  saveError,
  onNameChange,
  onDescriptionChange,
  onEditModeToggle,
  onSave,
  additionalBadges,
  readOnlyName = false,
  hideDescription = false,
  viewMode = 'visual',
  onViewModeChange,
  questionId,
  onPublish,
  anyDirtyFiles = false,
}: DocumentHeaderProps) {
  const metadata = getFileTypeMetadata(fileType);
  const [validationError, setValidationError] = useState<string | null>(null);
  const showJson = useAppSelector((state) => state.ui.showJson);

  // System files (connection, config, styles, context) always use inline Save.
  // All other files use Publish when onPublish is provided.
  const isSystemFile = isSystemFileType(fileType as FileType);
  const showPublishButton = !isSystemFile && !!onPublish;

  // Validate and save
  const handleSave = useCallback(() => {
    const placeholders = DEFAULT_PLACEHOLDERS[fileType];
    const trimmedName = name.trim();

    // Validate name (required)
    if (!trimmedName || trimmedName === placeholders.name) {
      setValidationError(`Please enter a ${metadata.label} name before saving.`);
      return;
    }

    // Clear validation error and proceed with save
    setValidationError(null);
    onSave();
  }, [name, fileType, metadata.label, onSave]);

  // Combined error (validation takes precedence)
  const displayError = validationError || saveError;

  return (
    <Box>
      {/* Main Header Section */}
      <VStack align="start" gap={1} mb={2}>
        <HStack justify="space-between" width="100%" flexWrap="wrap" gap={2} align="center">
          {/* Title and Description */}
          <VStack align="start" gap={0.5} flex="1">
            {/* Title */}
            {editMode && !readOnlyName ? (
              <Input
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                fontSize={{ base: 'xl', md: '2xl' }}
                fontWeight="900"
                letterSpacing="-0.02em"
                color="fg.default"
                fontFamily="mono"
                variant="flushed"
                placeholder={`Add a ${metadata.label} name`}
                borderBottom="1px dashed"
                borderColor="border.muted"
                bg="transparent"
                _focus={{ borderColor: 'border.emphasized', outline: 'none' }}
                px={0}
                py={0}
                h="auto"
                minH="0"
              />
            ) : (
              <Heading
                fontSize={{ base: 'xl', md: '2xl' }}
                fontWeight="900"
                letterSpacing="-0.02em"
                color="fg.default"
                fontFamily="mono"
                onDoubleClick={readOnlyName ? undefined : onEditModeToggle}
                cursor={readOnlyName ? 'default' : 'text'}
              >
                {name}
              </Heading>
            )}

            {/* Description with inline badges */}
            <HStack gap={2} align="center" width="100%" flexWrap="wrap">
              {!hideDescription && editMode ? (
                <Input
                  value={description || ''}
                  onChange={(e) => onDescriptionChange(e.target.value)}
                  placeholder="Add a description"
                  color="fg.muted"
                  fontSize="sm"
                  fontWeight="600"
                  lineHeight="1.5"
                  variant="flushed"
                  borderBottom="1px dashed"
                  borderColor="border.muted"
                  borderRadius="0"
                  bg="transparent"
                  _focus={{ borderColor: 'border.emphasized', outline: 'none' }}
                  _placeholder={{ color: 'fg.subtle' }}
                  px={0}
                  py={0}
                  h="auto"
                  minH="0"
                  flex="1"
                />
              ) : (
                !hideDescription && description && (
                  <Text
                    color="fg.muted"
                    fontSize="sm"
                    lineHeight="1.5"
                    fontWeight="600"
                    maxW="800px"
                    onDoubleClick={onEditModeToggle}
                    cursor="text"
                  >
                    {description}
                  </Text>
                )
              )}

              {/* Badges inline with description */}
              {!editMode && (
              <HStack gap={1.5}>
                {/* Document type badge */}
                <FileTypeBadge fileType={fileType} />

                {/* Additional badges */}
                {additionalBadges}
              </HStack>
                )}
            </HStack>
          </VStack>

          {/* Actions */}
          <HStack gap={2} flexShrink={0}>
            {/* Unsaved changes warning */}
            {editMode && isDirty && (
              <HStack
                gap={1.5}
                px={2}
                py={1}
                bg="accent.warning/15"
                borderRadius="md"
                border="1px solid"
                borderColor="accent.warning/30"
              >
                <LuTriangleAlert size={14} color="var(--chakra-colors-accent-warning)" />
                <Text fontSize="xs" color="accent.warning" fontWeight="600">
                  Unsaved changes
                </Text>
              </HStack>
            )}

            {/* Explain Button (show in view mode for questions) */}
            {!editMode && questionId !== undefined && (
              <ExplainButton questionId={questionId} size="xs" />
            )}

            {/* Save / Publish Button */}
            {/* Publish: shown only when the current file has unsaved changes */}
            {editMode && showPublishButton ? (
              <IconButton
                onClick={onPublish}
                aria-label="Publish changes"
                size="xs"
                colorPalette="teal"
                disabled={!isDirty}
                px={2}
              >
                <LuUpload />
                Publish
              </IconButton>
            ) : editMode && (
              <IconButton
                onClick={handleSave}
                aria-label="Save"
                loading={isSaving}
                size="xs"
                colorPalette="teal"
                disabled={!isDirty}
                px={2}
              >
                <LuSave />
                Save
              </IconButton>
            )}

            {/* Edit/Cancel Button */}
            <IconButton
              onClick={onEditModeToggle}
              aria-label={editMode ? 'Cancel editing' : 'Edit'}
              variant="subtle"
              size="xs"
              px={2}
            >
              {!editMode && <LuPencil />}
              {editMode ? 'Cancel' : 'Edit'}
            </IconButton>
            {/* JSON View Toggle (shown only when showJson setting is enabled) */}
            {onViewModeChange && showJson && (
              <TabSwitcher
                tabs={[
                  { value: 'visual', label: 'Visual view', icon: LuEye },
                  { value: 'json', label: 'JSON view', icon: LuCode }
                ]}
                activeTab={viewMode}
                onTabChange={(tab) => onViewModeChange(tab as 'visual' | 'json')}
                accentColor={metadata.color}
              />
            )}
          </HStack>
        </HStack>
      </VStack>

      {/* Save Error Banner */}
      {displayError && (
        <Box
          bg="bg.error"
          borderLeft="4px solid"
          borderColor="accent.danger"
          px={4}
          py={3}
          mb={4}
          borderRadius="md"
        >
          <HStack gap={2} align="start">
            <LuTriangleAlert size={20} color="var(--chakra-colors-accent-danger)" />
            <VStack align="start" gap={1} flex={1}>
              <Text fontSize="sm" fontWeight="600" color="accent.danger">
                Failed to save
              </Text>
              <Text fontSize="sm" color="fg.muted">
                {displayError}
              </Text>
            </VStack>
          </HStack>
        </Box>
      )}
    </Box>
  );
}
