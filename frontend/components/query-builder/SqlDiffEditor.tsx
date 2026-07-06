'use client';

import dynamic from 'next/dynamic';

// PERFORMANCE EXCEPTION — monaco-editor (~73 MB of JS) is lazy-loaded via next/dynamic
// rather than imported statically. Monaco is browser-only (ssr: false is correct) and is
// only needed on question/editor pages. A static import pulled the entire 73 MB package
// into the Turbopack dev cache for every page in the app, slowing every unrelated page's
// first compile. next/dynamic is the documented Next.js pattern for this exact scenario.
// This is NOT a circular-dependency workaround — that is the sole reason the rule exists.
// Sibling to SqlEditor.tsx's own targeted `Editor` dynamic import; do not expand this block.
/* eslint-disable no-restricted-syntax */
const DiffEditor = dynamic(
  () => import('@monaco-editor/react').then(mod => ({ default: mod.DiffEditor })),
  { ssr: false }
);
/* eslint-enable no-restricted-syntax */

interface SqlDiffEditorProps {
  value: string;
  proposedValue: string;
  editorTheme: string;
  colorMode: string;
  fillHeight: boolean;
  height: number;
}

/**
 * Diff mode for SqlEditor: shows current (original) vs proposed (modified) SQL
 * side-by-side. Always read-only.
 */
export default function SqlDiffEditor({
  value,
  proposedValue,
  editorTheme,
  colorMode,
  fillHeight,
  height,
}: SqlDiffEditorProps) {
  return (
    <DiffEditor
      height={fillHeight ? '100%' : `${height}px`}
      language="sql"
      original={value}
      modified={proposedValue}
      theme={editorTheme}
      keepCurrentOriginalModel
      keepCurrentModifiedModel
      onMount={(_editor, monaco) => {
        // Define custom theme
        monaco.editor.defineTheme('custom-theme', {
          base: colorMode === 'dark' ? 'vs-dark' : 'vs',
          inherit: true,
          rules: [],
          colors: {
            'editor.background': colorMode === 'dark' ? '#161b22' : '#ffffff',
          }
        });
        monaco.editor.setTheme('custom-theme');
      }}
      options={{
        readOnly: true,  // Diff view is always read-only
        fontFamily: 'var(--font-jetbrains-mono)',
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        automaticLayout: true,
        renderSideBySide: true,  // Side-by-side diff view
        padding: {
          top: 12,
          bottom: 12,
        },
      }}
    />
  );
}
