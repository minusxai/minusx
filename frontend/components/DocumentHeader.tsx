'use client';

import { ReactNode, useState, useCallback, useEffect } from 'react';
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
import { Tooltip } from '@/components/ui/tooltip';
import { LuSave, LuPencil, LuTriangleAlert, LuCircleAlert, LuEye, LuCode, LuFileDiff, LuPresentation, LuMinimize } from 'react-icons/lu';
import { getFileTypeMetadata } from '@/lib/ui/file-metadata';
import TabSwitcher from './TabSwitcher';
import FileTypeBadge from './FileTypeBadge';
import ExplainButton from '@/components/ExplainButton';
import { GenerateButton } from './ui/GenerateButton';
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

// Gentle entrance for the save/validation banner.
const alertInKeyframes = `
  @keyframes documentHeaderAlertIn {
    from { opacity: 0; transform: translateY(-3px); }
    to   { opacity: 1; transform: translateY(0); }
  }
`;

// Default placeholder values that should be treated as empty
const DEFAULT_PLACEHOLDERS: Record<string, { name: string; description: string }> = {
  question: { name: 'New Question', description: 'Helpful description about this question.' },
  dashboard: { name: 'New Dashboard', description: 'Helpful description about this dashboard.' },
  notebook: { name: 'New Notebook', description: 'Helpful description about this notebook.' },
  report: { name: 'New Report', description: 'Helpful description about this report.' },
  alert: { name: 'New Alert', description: 'Helpful description about this alert.' },
  context: { name: 'New Knowledge Base', description: 'Helpful description about this knowledge base.' },
};

export interface DocumentHeaderProps {
  // Content
  name: string;
  description?: string;
  fileType: 'question' | 'dashboard' | 'notebook' | 'report' | 'context' | 'alert';

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
  /**
   * Optional extra validation run when Save is clicked. Return a message to BLOCK
   * the save and surface it to the user (Save stays enabled); return null to
   * proceed. Use for conditions the user can fix in-place (e.g. a doc missing a
   * title/description) rather than hard-disabling Save with no explanation.
   */
  validateBeforeSave?: () => string | null;

  // Optional "generate with AI" affordances, shown next to an EMPTY title /
  // description field in edit mode. When omitted, no button is rendered.
  onGenerateName?: () => void;
  onGenerateDescription?: () => void;
  isGeneratingName?: boolean;
  isGeneratingDescription?: boolean;

  // Optional customization
  additionalBadges?: ReactNode;  // Additional badges to show next to type badge
  headerActions?: ReactNode;     // Extra controls in the always-visible Actions row (both edit + view mode)
  readOnlyName?: boolean;        // If true, name cannot be edited
  hideDescription?: boolean;     // If true, description field is not shown
  hideEditToggle?: boolean;      // If true, Edit/Cancel button is hidden (e.g. for new unsaved files)
  skipNameValidation?: boolean;  // If true, skip name check on save (e.g. save modal handles it)

  // Visual / Code view toggle (optional - shown only for admins when provided).
  // 'json' is the Code view (JSON + agent XML); value kept as 'json' for back-compat.
  viewMode?: 'visual' | 'json';  // Current view mode
  onViewModeChange?: (mode: 'visual' | 'json') => void;  // View mode change handler

  // Explain button (optional - shown for questions)
  questionId?: number;  // If provided, show explain button in view mode

  // Present (fullscreen) toggle — generic across file types. Shown in view mode
  // when provided; `isPresenting` flips it to an Exit affordance.
  onTogglePresent?: () => void;
  isPresenting?: boolean;

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
  validateBeforeSave,
  onGenerateName,
  onGenerateDescription,
  isGeneratingName = false,
  isGeneratingDescription = false,
  additionalBadges,
  headerActions,
  readOnlyName = false,
  hideDescription = false,
  hideEditToggle = false,
  skipNameValidation = false,
  viewMode = 'visual',
  onViewModeChange,
  questionId,
  onTogglePresent,
  isPresenting = false,
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

  // Validation errors are edit-time only — drop them when leaving edit mode
  // (e.g. Cancel) so a stale "needs a title" banner doesn't linger.
  useEffect(() => {
    if (!editMode) setValidationError(null);
  }, [editMode]);

  // Validate and save
  const handleSave = useCallback(() => {
    if (!skipNameValidation && !validateName()) return;
    // Caller-provided validation (e.g. context docs need title + description).
    // Surface the reason instead of silently no-op'ing, and keep Save enabled.
    const blockReason = validateBeforeSave?.();
    if (blockReason) {
      setValidationError(blockReason);
      return;
    }
    onSave();
  }, [skipNameValidation, validateName, validateBeforeSave, onSave]);

  // Combined error (validation takes precedence). Validation = "you need to fix
  // something" → amber/attention; a real save failure → red/danger.
  const displayError = validationError || saveError;
  const alertTone = validationError
    ? { fg: 'accent.warning', bg: 'accent.warning/10', border: 'accent.warning/30', icon: LuCircleAlert, label: 'Cannot save yet' }
    : { fg: 'accent.danger', bg: 'bg.error', border: 'accent.danger/25', icon: LuTriangleAlert, label: 'Save failed' };

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
        <HStack justify="space-between" width="100%" flexWrap="wrap" gap={2} align="start">
          {/* Title and Description */}
          <VStack align="start" gap={0.5} flex="1" minW={0}>
            {/* Title */}
            {editMode && !readOnlyName ? (
              <HStack width="100%" gap={2} align="center">
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
                  // When empty (generate button visible) the input shrinks to its
                  // placeholder so the "Auto" chip sits right next to the prompt text.
                  flex={onGenerateName && !name.trim() ? '0 1 auto' : '1'}
                  width={onGenerateName && !name.trim() ? 'auto' : undefined}
                />
                {onGenerateName && !name.trim() && (
                  <GenerateButton
                    label={`Generate ${metadata.label} name`}
                    loading={isGeneratingName}
                    onClick={onGenerateName}
                  />
                )}
              </HStack>
            ) : (
              <Heading
                fontSize={{ base: 'xl', md: '2xl' }}
                fontWeight="900"
                letterSpacing="-0.02em"
                color={titleColor}
                fontFamily="mono"
                maxW="100%"
                lineClamp={1}
                title={name}
                onDoubleClick={readOnlyName ? undefined : onEditModeToggle}
                cursor={readOnlyName ? 'default' : 'text'}
              >
                {name}
              </Heading>
            )}

            {/* Description (single line, ellipsised). The type/extra badges
                live in the right column above the actions — keeping the header
                to two rows. */}
            <Box width="100%">
              {!hideDescription && editMode ? (
                <HStack width="100%" gap={2} align="center">
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
                    // Shrink to the placeholder while empty so the "Auto" chip sits beside it.
                    flex={onGenerateDescription && !(description || '').trim() ? '0 1 auto' : '1'}
                    width={onGenerateDescription && !(description || '').trim() ? 'auto' : undefined}
                  />
                  {onGenerateDescription && !(description || '').trim() && (
                    <GenerateButton
                      label="Generate description"
                      loading={isGeneratingDescription}
                      onClick={onGenerateDescription}
                    />
                  )}
                </HStack>
              ) : (
                !hideDescription && description && (
                  <Text
                    color={subtitleColor}
                    fontSize="sm"
                    lineHeight="1.5"
                    fontWeight="600"
                    maxW="800px"
                    lineClamp={1}
                    title={description}
                    onDoubleClick={onEditModeToggle}
                    cursor="text"
                  >
                    {description}
                  </Text>
                )
              )}
            </Box>
          </VStack>

          {/* Right column: type/extra badges above the action buttons. Shown in
              both view and edit mode so the row height (and the actions below)
              stay put when toggling Edit. */}
          <VStack align="end" gap={1.5} flexShrink={0}>
            {/* While presenting, the header collapses to nothing but the Exit
                control — no badges, no edit/save/tools — for a clean fullscreen. */}
            {!isPresenting && (
              <HStack gap={1.5} flexWrap="wrap" justify="flex-end">
                <FileTypeBadge fileType={fileType} />
                {additionalBadges}
              </HStack>
            )}
          <HStack gap={2} flexShrink={0} align="center">
            {/* Contextual view tools registered by the file view (Run all, Present, …) */}
            {!isPresenting && headerActions}

            {/* Divider separating contextual view tools from the document
                lifecycle actions (review / edit / save) so the row reads as
                two distinct groups rather than one crowded strip. */}
            {!isPresenting && headerActions && <Box w="1px" h="16px" bg="border.emphasized" flexShrink={0} />}

            {/* Explain Button (show in view mode for questions) */}
            {!isPresenting && !editMode && questionId !== undefined && (
              <ExplainButton questionId={questionId} size="xs" />
            )}

            {/* Review unsaved changes — informational status chip, not an action */}
            {!isPresenting && onReviewChanges && dirtyFileCount > 0 && (
              <HStack
                as="button"
                onClick={onReviewChanges}
                aria-label={`Review ${dirtyFileCount} unsaved changes`}
                gap={1.5}
                h="26px"
                px={2}
                borderRadius="md"
                bg="bg.muted"
                borderWidth="1px"
                borderColor="border.muted"
                color="fg.muted"
                _hover={{ color: 'fg.default', borderColor: 'border.emphasized' }}
                transition="color 0.15s, border-color 0.15s"
                cursor="pointer"
                flexShrink={0}
              >
                <Icon as={LuFileDiff} boxSize={3.5} />
                <Text fontSize="xs" fontWeight="600" fontFamily="mono">
                  Review {dirtyFileCount} change{dirtyFileCount > 1 ? 's' : ''}
                </Text>
              </HStack>
            )}

            {/* Save button — always visible in edit mode, disabled when clean */}
            {!isPresenting && editMode && (
                <IconButton
                    onClick={handleSave}
                    aria-label={'Save'}
                    loading={isSaving}
                    disabled={!isDirty}
                    size="xs"
                    colorPalette="teal"
                    px={2}
                    h="26px"
                >
                    <LuSave />
                    {'Save'}
                </IconButton>
            )}

            {/* Present (fullscreen) — generic across file types; view mode only */}
            {onTogglePresent && (!editMode || isPresenting) && (
              <Tooltip content={isPresenting ? 'Exit presentation' : 'Present fullscreen'}>
                <IconButton
                  onClick={onTogglePresent}
                  aria-label={isPresenting ? 'Exit presentation' : 'Present'}
                  variant="ghost"
                  size="xs"
                  minW="26px"
                  px={0}
                  h="26px"
                  bg={isPresenting ? 'bg.emphasized' : 'bg.muted'}
                  borderWidth="1px"
                  borderColor="border.muted"
                  color={isPresenting ? 'fg.default' : 'fg.muted'}
                  _hover={{ color: 'fg.default', bg: 'bg.emphasized' }}
                >
                  {isPresenting ? <LuMinimize /> : <LuPresentation />}
                </IconButton>
              </Tooltip>
            )}

            {/* Edit/Cancel Button — matches the header toolbar pill aesthetic */}
            {!isPresenting && !hideEditToggle && (
            <IconButton
              onClick={onEditModeToggle}
              aria-label={editMode ? 'Cancel editing' : 'Edit'}
              variant="ghost"
              size="xs"
              px={2}
              h="26px"
              bg="bg.muted"
              borderWidth="1px"
              borderColor="border.muted"
              color="fg.muted"
              _hover={{ color: 'fg.default', bg: 'bg.emphasized' }}
            >
              {!editMode && <LuPencil />}
              {editMode ? 'Cancel' : 'Edit'}
            </IconButton>
            )}
            {/* Visual / Code view toggle (shown only when devMode is enabled) */}
            {!isPresenting && onViewModeChange && showJson && (
              <TabSwitcher
                tabs={[
                  { value: 'visual', label: 'Visual view', icon: LuEye },
                  { value: 'json', label: 'Code view', icon: LuCode }
                ]}
                activeTab={viewMode}
                onTabChange={(tab) => onViewModeChange(tab as 'visual' | 'json')}
                accentColor={metadata.color}
              />
            )}
          </HStack>
          </VStack>
        </HStack>
      </VStack>

      {/* Save / validation banner */}
      {displayError && (
        <>
          <style>{alertInKeyframes}</style>
          <Box
            role="alert"
            aria-label={displayError}
            display="flex"
            alignItems="flex-start"
            gap={2.5}
            bg={alertTone.bg}
            borderWidth="1px"
            borderColor={alertTone.border}
            px={3.5}
            py={2.5}
            mb={4}
            borderRadius="md"
            css={{ animation: 'documentHeaderAlertIn 0.18s ease-out' }}
          >
            {/* mt nudges the icon onto the cap-height of the uppercase label */}
            <Icon as={alertTone.icon} boxSize={4} color={alertTone.fg} flexShrink={0} mt="2px" />
            <VStack align="start" gap={0.5} flex={1} minW={0}>
              <Text
                fontSize="2xs"
                fontWeight="700"
                fontFamily="mono"
                letterSpacing="0.04em"
                textTransform="uppercase"
                color={alertTone.fg}
              >
                {alertTone.label}
              </Text>
              <Text fontSize="sm" color="fg.default" lineHeight="1.5">
                {displayError}
              </Text>
            </VStack>
          </Box>
        </>
      )}
    </Box>
  );
}
