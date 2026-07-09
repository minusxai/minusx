/**
 * UI test setup — runs before all *.ui.test.tsx files.
 *
 * Adds JSDOM-specific mocks that can't live in the shared node setup (which also runs
 * in the Node environment used by backend/integration tests).
 */

import '@testing-library/jest-dom';

// ---------------------------------------------------------------------------
// structuredClone polyfill
// jsdom doesn't expose the Node.js global structuredClone
// to the JSDOM window scope. Chakra UI (use-recipe.cjs) calls it at render.
// Use v8.serialize/deserialize which correctly handles undefined, Maps, Sets,
// and all other structured-clone-compatible types (unlike JSON.parse/stringify).
// ---------------------------------------------------------------------------
if (typeof structuredClone === 'undefined') {
   
  const v8 = require('v8') as typeof import('v8');
  (global as any).structuredClone = (val: unknown) => v8.deserialize(v8.serialize(val));
}

// ---------------------------------------------------------------------------
// Monaco Editor → plain <textarea>
// Components using @monaco-editor/react will render a textarea in tests.
// The mock fires onMount so hooks that depend on the editor instance work.
// ---------------------------------------------------------------------------
vi.mock('@monaco-editor/react', () => {
  const React = require('react');
  const MockEditor = ({ value, onChange, onMount, ...props }: any) => {
    React.useEffect(() => {
      // Editor instance stub — covers every method SqlEditor.onMount calls:
      //   focus, trigger, getPosition, getModel, onDidDispose, onKeyUp,
      //   onDidChangeModelContent, deltaDecorations, addCommand.
      // getModel() returns null so updateDecorations/triggerValidation return early.
      const editorStub = {
        getValue: () => value ?? '',
        setValue: vi.fn(),
        focus: vi.fn(),
        trigger: vi.fn(),
        getPosition: () => null,
        getModel: () => null,
        onDidDispose: vi.fn(),
        onKeyUp: vi.fn(),
        onDidChangeModelContent: vi.fn(),
        // "Interact with {agentName}" selection listeners + position getters.
        onMouseUp: vi.fn(),
        onDidChangeCursorSelection: vi.fn(),
        onDidScrollChange: vi.fn(),
        getSelection: () => null,
        getScrolledVisiblePosition: () => null,
        getDomNode: () => null,
        deltaDecorations: vi.fn(() => []),
        addCommand: vi.fn(),
      };
      // Monaco instance stub — covers everything SqlEditor.onMount references on
      // the second arg: languages providers, editor theme/markers/keybindings,
      // Range constructor, KeyMod/KeyCode constants, MarkerSeverity.
      const monacoStub = {
        languages: {
          registerCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
          registerHoverProvider: vi.fn(() => ({ dispose: vi.fn() })),
        },
        editor: {
          defineTheme: vi.fn(),
          setTheme: vi.fn(),
          setModelMarkers: vi.fn(),
          addKeybindingRules: vi.fn(),
        },
        Range: vi.fn((sl: number, sc: number, el: number, ec: number) => ({
          startLineNumber: sl, startColumn: sc, endLineNumber: el, endColumn: ec,
        })),
        KeyMod: { CtrlCmd: 0 },
        KeyCode: { Enter: 0, KeyK: 0 },
        MarkerSeverity: { Error: 8 },
      };
      onMount?.(editorStub, monacoStub);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return React.createElement('textarea', {
      // Honor an explicit options.ariaLabel (JsonEditor); SqlEditor doesn't set one
      'aria-label': props.options?.ariaLabel ?? 'SQL editor',
      value: value ?? props.defaultValue ?? '',
      onChange: (e: any) => onChange?.(e.target.value),
      // Honor an explicit options.readOnly (JsonEditor); else infer from onChange
      readOnly: props.options?.readOnly ?? !onChange,
    });
  };
  // __esModule: true is required so that `import Editor from '@monaco-editor/react'`
  // resolves to MockEditor (the default export) rather than the whole module object.
  // Without it Vitest treats the return value as a CJS module and the default import
  // receives the entire { default, Editor, DiffEditor } object — causing React to
  // throw "Element type is invalid: got: object" when SqlEditor tries to render it.
  return { __esModule: true, default: MockEditor, Editor: MockEditor, DiffEditor: MockEditor };
});

// ---------------------------------------------------------------------------
// LexicalMentionEditor → plain <textarea> with aria-label
// ChatInput uses LexicalMentionEditor. The mock calls onChange/onSubmit so
// tests can type into it and submit messages.
// ---------------------------------------------------------------------------
vi.mock('@/components/chat/LexicalMentionEditor', () => {
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
vi.mock('@/components/modals/PublishModal', () => {
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
// react-markdown + remark-gfm → plain <div>
// ESM-only packages we mock with a simple passthrough
// that renders children as text (sufficient for UI tests).
// ---------------------------------------------------------------------------
vi.mock('react-markdown', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ children }: any) => React.createElement('div', { 'data-testid': 'markdown' }, children),
  };
});
vi.mock('remark-gfm', () => ({
  __esModule: true,
  default: () => {},
}));

// ---------------------------------------------------------------------------
// ECharts → <canvas> stub
// Prevents "HTMLCanvasElement.getContext is not a function" in JSDOM.
// echarts-init.ts runs echarts.use() at module-load time using echarts/core
// (an ESM-only sub-path).  Mock the init module so nothing executes.
// ---------------------------------------------------------------------------
vi.mock('@/lib/chart/echarts-init', () => ({}));
vi.mock('echarts', () => ({
  init: vi.fn(() => ({
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    getWidth: vi.fn(() => 0),
    getHeight: vi.fn(() => 0),
  })),
  use: vi.fn(),
  registerTheme: vi.fn(),
  graphic: { LinearGradient: vi.fn() },
}));

// ---------------------------------------------------------------------------
// mirrorAppStyles → no-op
// AgentHtml (story/slide canvas) copies the document's stylesheet rules into
// its shadow root so portaled charts inherit Chakra styling. In jsdom that
// read (cssRules/cssText) is a slow JS reimplementation, and the injected
// emotion/Chakra <style> tags accumulate across a test file's shared document,
// so re-serializing every rule on each render goes O(n²) — it turned a 9-test
// story-view file into ~13 minutes. The mirror has no observable effect in
// tests (charts are mocked), so faking it to a no-op is free.
// ---------------------------------------------------------------------------
vi.mock('@/lib/html/mirror-app-styles', () => ({
  mirrorAppStyles: () => {},
}));

// ---------------------------------------------------------------------------
// Next.js navigation
// ---------------------------------------------------------------------------
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

// Custom navigation wrapper (used by FileHeader)
vi.mock('@/lib/navigation/use-navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  getRouter: vi.fn(() => null),
}));

// ---------------------------------------------------------------------------
// PointerEvent polyfill — jsdom doesn't implement it, but @zag-js (Chakra
// checkbox/press interactions) constructs one on blur. MouseEvent carries all
// the fields zag reads.
// ---------------------------------------------------------------------------
if (typeof window !== 'undefined' && typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? '';
    }
  }
  (window as any).PointerEvent = PointerEventPolyfill;
  (global as any).PointerEvent = PointerEventPolyfill;
}

// ---------------------------------------------------------------------------
// ResizeObserver polyfill (react-grid-layout uses it)
// ---------------------------------------------------------------------------
global.ResizeObserver = vi.fn().mockImplementation(function (this: any) {
  this.observe = vi.fn();
  this.unobserve = vi.fn();
  this.disconnect = vi.fn();
});

// ---------------------------------------------------------------------------
// HTMLCanvasElement.getContext stub (ECharts touches canvas in some paths)
// ---------------------------------------------------------------------------
HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as any;

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
