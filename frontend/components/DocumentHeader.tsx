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
  Icon,
} from '@chakra-ui/react';
import { LuSave, LuPencil, LuTriangleAlert, LuEye, LuCode, LuFiles } from 'react-icons/lu';
import { getFileTypeMetadata } from '@/lib/ui/file-metadata';
import TabSwitcher from './TabSwitcher';
import FileTypeBadge from './FileTypeBadge';
import ExplainButton from '@/components/ExplainButton';
import { useAppSelector } from '@/store/hooks';

const pulseAnimation = `
  @keyframes borderPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
  @keyframes iconBlink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.2; }
  }
`;

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
  hideEditToggle?: boolean;      // If true, Edit/Cancel button is hidden (e.g. for new unsaved files)
  skipNameValidation?: boolean;  // If true, skip name check on save (e.g. save modal handles it)

  // JSON view toggle (optional - shown only for admins when provided)
  viewMode?: 'visual' | 'json';  // Current view mode
  onViewModeChange?: (mode: 'visual' | 'json') => void;  // View mode change handler

  // Explain button (optional - shown for questions)
  questionId?: number;  // If provided, show explain button in view mode

  // When other files have unsaved changes, show a "Review N unsaved changes" button.
  onReviewChanges?: () => void;
  dirtyFileCount?: number;

  // Number of files that will be saved (current + children). Shown on Save button label.
  saveCount?: number;

  // Optional highlight color for the header background (e.g. dashboard edit mode)
  highlightColor?: string;
  highlightLabel?: string;  // Label shown next to title when highlighted (e.g. "Editing Dashboard")
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
  hideEditToggle = false,
  skipNameValidation = false,
  viewMode = 'visual',
  onViewModeChange,
  questionId,
  onReviewChanges,
  dirtyFileCount = 0,
  saveCount = 1,
  highlightColor,
  highlightLabel,
}: DocumentHeaderProps) {
  const metadata = getFileTypeMetadata(fileType);
  const [validationError, setValidationError] = useState<string | null>(null);
  const showJson = useAppSelector((state) => state.ui.devMode);
  const titleColor = 'fg.default';
  const subtitleColor = 'fg.muted';

  // Validate name before save
  const validateName = useCallback((): boolean => {
    const placeholders = DEFAULT_PLACEHOLDERS[fileType];
    const trimmedName = name.trim();

    if (!trimmedName || trimmedName === placeholders?.name) {
      setValidationError(`Please enter a ${metadata.label} name before saving.`);
      return false;
    }

    setValidationError(null);
    return true;
  }, [name, fileType, metadata.label]);

  // Validate and save
  const handleSave = useCallback(() => {
    if (!skipNameValidation && !validateName()) return;
    onSave();
  }, [validateName, onSave]);

  // Combined error (validation takes precedence)
  const displayError = validationError || saveError;

  return (
    <Box
      {...(highlightColor ? {
        position: 'relative' as const,
        pl: 3,
      } : {})}
      css={highlightColor ? {
        '&::before': {
          content: '""',
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: '3px',
          backgroundColor: `var(--chakra-colors-${highlightColor.replace('.', '-')})`,
          borderRadius: '2px',
          animation: 'borderPulse 2s ease-in-out infinite',
        }
      } : undefined}
    >
      {highlightColor && <style>{pulseAnimation}</style>}
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
                color={titleColor}
                fontFamily="mono"
                variant="flushed"
                placeholder={`Add a ${metadata.label} name`}
                borderBottom="0px"
                // borderColor="border.muted"
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
                color={titleColor}
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
                  color={subtitleColor}
                  fontSize="sm"
                  fontWeight="600"
                  lineHeight="1.5"
                  variant="flushed"
                  borderBottom="0px"
                //   borderColor="border.muted"
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
                    color={subtitleColor}
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
            {/* Explain Button (show in view mode for questions) */}
            {!editMode && questionId !== undefined && (
              <ExplainButton questionId={questionId} size="xs" />
            )}

            {/* Review unsaved changes — muted text link, informational */}
            {onReviewChanges && dirtyFileCount > 0 && (
              <HStack
                as="button"
                onClick={onReviewChanges}
                aria-label={`Review ${dirtyFileCount} unsaved changes`}
                gap={1}
                px={1}
                color="fg.muted"
                _hover={{ color: 'fg.default' }}
                transition="color 0.15s"
                cursor="pointer"
              >
                <Icon as={LuFiles} boxSize={3.5} />
                <Text fontSize="xs" fontWeight="600" fontFamily="mono">
                  Review {dirtyFileCount} change{dirtyFileCount > 1 ? 's' : ''}
                </Text>
              </HStack>
            )}

            {/* Save button — always visible in edit mode, disabled when clean */}
            {editMode && (
              <IconButton
                onClick={handleSave}
                aria-label={'Save'}
                loading={isSaving}
                disabled={!isDirty}
                size="xs"
                colorPalette="teal"
                px={2}
              >
                <LuSave />
                {'Save'}
              </IconButton>
            )}

            {/* Edit/Cancel Button */}
            {!hideEditToggle && (
            <IconButton
              onClick={onEditModeToggle}
              aria-label={editMode ? 'Cancel editing' : 'Edit'}
              variant={editMode ? 'outline' : 'subtle'}
              size="xs"
              px={2}
            >
              {!editMode && <LuPencil />}
              {editMode ? 'Cancel' : 'Edit'}
            </IconButton>
            )}
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
