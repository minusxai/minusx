'use client';

/**
 * InsertMenuPlugin — a "+" insert menu for the docs Lexical editor, styled like
 * the @ / # mention typeaheads. Typing "+" (at a word boundary) opens a menu of
 * block options:
 *   - Image  → opens the file picker, uploads, inserts an inline image
 *   - Metric → inserts a metric block; its inline editor opens automatically
 *              (see MetricNode)
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  $insertNodes,
  COMMAND_PRIORITY_CRITICAL,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
} from 'lexical';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { Box, HStack, VStack, Text, Icon, Portal } from '@chakra-ui/react';
import { LuImage, LuSquareFunction } from 'react-icons/lu';
import type { IconType } from 'react-icons';
import { $createMetricNode } from './MetricNode';
import { $createImageNode } from './ImageNode';

interface InsertOption {
  key: 'image' | 'metric';
  label: string;
  description: string;
  icon: IconType;
}

interface InsertMenuPluginProps {
  onImageUpload?: (file: File) => Promise<string>;
  enableMetric?: boolean;
}

export function InsertMenuPlugin({ onImageUpload, enableMetric }: InsertMenuPluginProps) {
  const [editor] = useLexicalComposerContext();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [caret, setCaret] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const triggerLenRef = useRef(0);

  const allOptions: InsertOption[] = [
    ...(onImageUpload ? [{ key: 'image' as const, label: 'Image', description: 'Upload and embed an image', icon: LuImage }] : []),
    ...(enableMetric ? [{ key: 'metric' as const, label: 'Metric', description: 'Define a metric — name, description, SQL', icon: LuSquareFunction }] : []),
  ];
  const options = allOptions.filter((o) => o.label.toLowerCase().includes(query));

  // Latest values for the (once-registered) keyboard command handlers.
  const optionsRef = useRef(options);
  const openRef = useRef(open);
  const activeIndexRef = useRef(activeIndex);
  useEffect(() => { optionsRef.current = options; openRef.current = open; activeIndexRef.current = activeIndex; });

  const removeTrigger = useCallback(() => {
    const len = triggerLenRef.current;
    editor.update(() => {
      const sel = $getSelection();
      if ($isRangeSelection(sel) && sel.isCollapsed()) {
        const node = sel.anchor.getNode();
        if ($isTextNode(node)) {
          const end = sel.anchor.offset;
          const start = end - len;
          if (start >= 0) node.spliceText(start, len, '', true);
        }
      }
    });
  }, [editor]);

  const insertImage = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const insertMetric = useCallback(() => {
    editor.update(() => { $insertNodes([$createMetricNode({ name: '' })]); });
  }, [editor]);

  const selectOption = useCallback((opt: InsertOption) => {
    setOpen(false);
    removeTrigger();
    if (opt.key === 'image') insertImage();
    else if (opt.key === 'metric') insertMetric();
  }, [removeTrigger, insertImage, insertMetric]);

  // Detect the "+" trigger as the selection moves.
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel) || !sel.isCollapsed()) { setOpen(false); return; }
        const node = sel.anchor.getNode();
        if (!$isTextNode(node)) { setOpen(false); return; }
        const before = node.getTextContent().slice(0, sel.anchor.offset);
        // "+" preceded by start-or-whitespace, followed by word chars (so "+ " stays a list).
        const m = before.match(/(?:^|\s)\+(\w*)$/);
        if (!m) { setOpen(false); return; }
        triggerLenRef.current = m[1].length + 1;
        setQuery(m[1].toLowerCase());
        setActiveIndex(0);
        setOpen(true);
        const domSel = window.getSelection();
        if (domSel && domSel.rangeCount > 0) {
          const rect = domSel.getRangeAt(0).getBoundingClientRect();
          setCaret({ top: rect.bottom + 4, left: rect.left });
        }
      });
    });
  }, [editor]);

  // Keyboard navigation for the dropdown.
  useEffect(() => {
    const down = editor.registerCommand(KEY_ARROW_DOWN_COMMAND, (e) => {
      if (!openRef.current || optionsRef.current.length === 0) return false;
      e?.preventDefault();
      setActiveIndex((i) => (i + 1) % optionsRef.current.length);
      return true;
    }, COMMAND_PRIORITY_CRITICAL);
    const up = editor.registerCommand(KEY_ARROW_UP_COMMAND, (e) => {
      if (!openRef.current || optionsRef.current.length === 0) return false;
      e?.preventDefault();
      setActiveIndex((i) => (i - 1 + optionsRef.current.length) % optionsRef.current.length);
      return true;
    }, COMMAND_PRIORITY_CRITICAL);
    const enter = editor.registerCommand(KEY_ENTER_COMMAND, (e) => {
      if (!openRef.current || optionsRef.current.length === 0) return false;
      e?.preventDefault();
      selectOption(optionsRef.current[activeIndexRef.current]);
      return true;
    }, COMMAND_PRIORITY_CRITICAL);
    const esc = editor.registerCommand(KEY_ESCAPE_COMMAND, () => {
      if (!openRef.current) return false;
      setOpen(false);
      return true;
    }, COMMAND_PRIORITY_CRITICAL);
    return () => { down(); up(); enter(); esc(); };
  }, [editor, selectOption]);

  const handleImageFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !onImageUpload) return;
    const src = await onImageUpload(file);
    if (!src) return;
    editor.update(() => { $insertNodes([$createImageNode({ src, altText: file.name })]); });
  }, [editor, onImageUpload]);

  return (
    <>
      {onImageUpload && (
        <input
          aria-label="Upload image to insert"
          type="file"
          accept="image/*"
          ref={fileInputRef}
          style={{ display: 'none' }}
          onChange={handleImageFile}
        />
      )}

      {open && options.length > 0 && (
        <Portal>
          <Box
            position="fixed"
            top={`${caret.top}px`}
            left={`${caret.left}px`}
            zIndex={1500}
            minW="240px"
            bg="bg.surface"
            border="1px solid"
            borderColor="border.emphasized"
            borderRadius="md"
            boxShadow="lg"
            py={1}
            role="listbox"
            aria-label="Insert menu"
          >
            {options.map((opt, i) => (
              <HStack
                key={opt.key}
                aria-label={`Insert ${opt.label}`}
                role="option"
                aria-selected={i === activeIndex}
                px={3}
                py={2}
                gap={2.5}
                cursor="pointer"
                bg={i === activeIndex ? 'bg.emphasized' : 'transparent'}
                _hover={{ bg: 'bg.emphasized' }}
                onMouseDown={(e) => { e.preventDefault(); selectOption(opt); }}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <Icon as={opt.icon} boxSize={4} color="accent.cyan" flexShrink={0} />
                <VStack gap={0} align="stretch" minW={0}>
                  <Text fontSize="sm" fontWeight="600">{opt.label}</Text>
                  <Text fontSize="xs" color="fg.muted" truncate>{opt.description}</Text>
                </VStack>
              </HStack>
            ))}
          </Box>
        </Portal>
      )}
    </>
  );
}
