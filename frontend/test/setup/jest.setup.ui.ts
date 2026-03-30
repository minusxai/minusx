/**
 * UI test setup — runs before all *.ui.test.tsx files.
 *
 * Adds JSDOM-specific mocks that can't live in jest.setup.ts (which also runs
 * in the Node environment used by backend/integration tests).
 */

import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// structuredClone polyfill
// jest-environment-jsdom doesn't expose the Node.js global structuredClone
// to the JSDOM window scope. Chakra UI (use-recipe.cjs) calls it at render.
// Use v8.serialize/deserialize which correctly handles undefined, Maps, Sets,
// and all other structured-clone-compatible types (unlike JSON.parse/stringify).
// ---------------------------------------------------------------------------
if (typeof structuredClone === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const v8 = require('v8') as typeof import('v8');
  (global as any).structuredClone = (val: unknown) => v8.deserialize(v8.serialize(val));
}

// ---------------------------------------------------------------------------
// Monaco Editor → plain <textarea>
// Components using @monaco-editor/react will render a textarea in tests.
// The mock fires onMount so hooks that depend on the editor instance work.
// ---------------------------------------------------------------------------
jest.mock('@monaco-editor/react', () => {
  const React = require('react');
  const MockEditor = ({ value, onChange, onMount, ...props }: any) => {
    React.useEffect(() => {
      // Editor instance stub — covers every method SqlEditor.onMount calls:
      //   focus, trigger, getPosition, getModel, onDidDispose, onKeyUp,
      //   onDidChangeModelContent, deltaDecorations, addCommand.
      // getModel() returns null so updateDecorations/triggerValidation return early.
      const editorStub = {
        getValue: () => value ?? '',
        setValue: jest.fn(),
        focus: jest.fn(),
        trigger: jest.fn(),
        getPosition: () => null,
        getModel: () => null,
        onDidDispose: jest.fn(),
        onKeyUp: jest.fn(),
        onDidChangeModelContent: jest.fn(),
        deltaDecorations: jest.fn(() => []),
        addCommand: jest.fn(),
      };
      // Monaco instance stub — covers everything SqlEditor.onMount references on
      // the second arg: languages providers, editor theme/markers/keybindings,
      // Range constructor, KeyMod/KeyCode constants, MarkerSeverity.
      const monacoStub = {
        languages: {
          registerCompletionItemProvider: jest.fn(() => ({ dispose: jest.fn() })),
          registerHoverProvider: jest.fn(() => ({ dispose: jest.fn() })),
        },
        editor: {
          defineTheme: jest.fn(),
          setTheme: jest.fn(),
          setModelMarkers: jest.fn(),
          addKeybindingRules: jest.fn(),
        },
        Range: jest.fn((sl: number, sc: number, el: number, ec: number) => ({
          startLineNumber: sl, startColumn: sc, endLineNumber: el, endColumn: ec,
        })),
        KeyMod: { CtrlCmd: 0 },
        KeyCode: { Enter: 0, KeyK: 0 },
        MarkerSeverity: { Error: 8 },
      };
      onMount?.(editorStub, monacoStub);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return React.createElement('textarea', {
      'aria-label': 'SQL editor',
      value: value ?? '',
      onChange: (e: any) => onChange?.(e.target.value),
      readOnly: !onChange,
    });
  };
  // __esModule: true is required so that `import Editor from '@monaco-editor/react'`
  // resolves to MockEditor (the default export) rather than the whole module object.
  // Without it Jest treats the return value as a CJS module and the default import
  // receives the entire { default, Editor, DiffEditor } object — causing React to
  // throw "Element type is invalid: got: object" when SqlEditor tries to render it.
  return { __esModule: true, default: MockEditor, Editor: MockEditor, DiffEditor: MockEditor };
});

// ---------------------------------------------------------------------------
// LexicalMentionEditor → plain <textarea> with aria-label
// ChatInput uses LexicalMentionEditor. The mock calls onChange/onSubmit so
// tests can type into it and submit messages.
// ---------------------------------------------------------------------------
jest.mock('@/components/chat/LexicalMentionEditor', () => {
  const React = require('react');
  const MockLexical = ({ onChange, onSubmit, placeholder, disabled }: any) =>
    React.createElement('textarea', {
      'aria-label': 'Chat message',
      placeholder,
      disabled: disabled || false,
      onChange: (e: any) => onChange?.(e.target.value),
      onKeyDown: (e: any) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          onSubmit?.();
        }
      },
    });
  return { LexicalMentionEditor: MockLexical };
});

// ---------------------------------------------------------------------------
// PublishModal pulls in the full file-component tree (all container + view
// types) which transitively imports ESM-only packages (react-markdown,
// remark-gfm, …).  Stub the modal — tests that need it exercise it via
// aria-label selectors on the real FileHeader; the modal content itself is
// outside scope for UI unit tests.
// ---------------------------------------------------------------------------
jest.mock('@/components/PublishModal', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ isOpen, onClose }: any) =>
      isOpen
        ? React.createElement('div', { role: 'dialog', 'aria-label': 'Publish changes modal' },
            React.createElement('button', { onClick: onClose }, 'Close')
          )
        : null,
  };
});

// ---------------------------------------------------------------------------
// ECharts → <canvas> stub
// Prevents "HTMLCanvasElement.getContext is not a function" in JSDOM.
// echarts-init.ts runs echarts.use() at module-load time using echarts/core
// (an ESM-only sub-path).  Mock the init module so nothing executes.
// ---------------------------------------------------------------------------
jest.mock('@/lib/chart/echarts-init', () => ({}));
jest.mock('echarts', () => ({
  init: jest.fn(() => ({
    setOption: jest.fn(),
    resize: jest.fn(),
    dispose: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    getWidth: jest.fn(() => 0),
    getHeight: jest.fn(() => 0),
  })),
  use: jest.fn(),
  registerTheme: jest.fn(),
  graphic: { LinearGradient: jest.fn() },
}));

// ---------------------------------------------------------------------------
// Next.js navigation
// ---------------------------------------------------------------------------
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), forward: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

// Custom navigation wrapper (used by FileHeader)
jest.mock('@/lib/navigation/use-navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), forward: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() }),
  getRouter: jest.fn(() => null),
}));

// ---------------------------------------------------------------------------
// ResizeObserver polyfill (react-grid-layout uses it)
// ---------------------------------------------------------------------------
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn(),
}));

// ---------------------------------------------------------------------------
// HTMLCanvasElement.getContext stub (ECharts touches canvas in some paths)
// ---------------------------------------------------------------------------
HTMLCanvasElement.prototype.getContext = jest.fn(() => null) as any;

// ---------------------------------------------------------------------------
// Mute console.error for known JSDOM/Chakra noise during tests
// ---------------------------------------------------------------------------
const originalError = console.error.bind(console);
beforeAll(() => {
  console.error = (...args: any[]) => {
    const msg = typeof args[0] === 'string' ? args[0] : '';
    if (
      msg.includes('Warning: ReactDOM.render') ||
      msg.includes('act(') ||
      msg.includes('Not implemented: navigation')
    ) {
      return;
    }
    originalError(...args);
  };
});
afterAll(() => {
  console.error = originalError;
});
