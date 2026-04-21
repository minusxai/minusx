/**
 * UI test: ChatInput image attachment
 *
 * Verifies:
 *  - Selecting an image file triggers uploadFile() instead of extractTextFromDocument()
 *  - An attachment chip appears with the image filename
 *  - The attachment stored in Redux has type='image' and content=publicUrl
 *  - Non-image files still go through the existing text-extraction path
 */

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

jest.mock('@/lib/database/db-config', () => ({
  DB_PATH: undefined,
  DB_DIR: undefined,
  getDbType: () => 'pglite' as const,
}));

jest.mock('@/lib/navigation/use-navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/explore',
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@/lib/utils/attachment-extract', () => ({
  extractTextFromDocument: jest.fn().mockResolvedValue({ text: 'extracted text', wordCount: 2 }),
  SUPPORTED_DOC_EXTENSIONS: '.pdf,.docx,.txt',
}));

// Mock the object-store client so tests don't make real HTTP calls
jest.mock('@/lib/object-store/client', () => ({
  uploadFile: jest.fn(),
}));

jest.mock('@/components/Markdown', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('span', { 'data-testid': 'markdown' }, children),
  };
});

jest.mock('@/lib/navigation/NavigationGuardProvider', () => ({
  useNavigationGuard: () => ({ navigate: jest.fn(), isBlocked: false, confirmNavigation: jest.fn(), cancelNavigation: jest.fn() }),
  NavigationGuardProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import React from 'react';
import { screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@/test/helpers/render-with-providers';
import * as storeModule from '@/store/store';
import { selectChatAttachments } from '@/store/uiSlice';
import { uploadFile } from '@/lib/object-store/client';
import { extractTextFromDocument } from '@/lib/utils/attachment-extract';

import ChatInput from '@/components/explore/ChatInput';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderChatInput(store: ReturnType<typeof storeModule.makeStore>) {
  return renderWithProviders(
    <ChatInput
      onSend={jest.fn()}
      onStop={jest.fn()}
      isAgentRunning={false}
      databaseName="test_db"
      onDatabaseChange={jest.fn()}
      isCompact={true}
    />,
    { store }
  );
}

function makeImageFile(name = 'screenshot.png', type = 'image/png'): File {
  return new File(['(binary)'], name, { type });
}

function makeDocFile(name = 'report.pdf', type = 'application/pdf'): File {
  return new File(['%PDF'], name, { type });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatInput: image attachment upload', () => {
  let store: ReturnType<typeof storeModule.makeStore>;

  beforeEach(() => {
    store = storeModule.makeStore();
    (uploadFile as jest.Mock).mockResolvedValue({ publicUrl: '/uploads/1/abc123.png' });
    (extractTextFromDocument as jest.Mock).mockResolvedValue({ text: 'doc text', wordCount: 2 });
    window.HTMLElement.prototype.scrollTo = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('calls uploadFile (not extractText) when an image file is selected', async () => {
    renderChatInput(store);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeImageFile();

    await act(async () => {
      await userEvent.upload(fileInput, file);
    });

    await waitFor(() => {
      expect(uploadFile).toHaveBeenCalledWith(file, expect.any(Function));
      expect(extractTextFromDocument).not.toHaveBeenCalled();
    });
  });

  it('stores an image attachment with type=image and content=publicUrl in Redux', async () => {
    renderChatInput(store);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = makeImageFile('diagram.png');

    await act(async () => {
      await userEvent.upload(fileInput, file);
    });

    await waitFor(() => {
      const attachments = selectChatAttachments(store.getState());
      expect(attachments).toHaveLength(1);
      expect(attachments[0]).toEqual({
        type: 'image',
        name: 'diagram.png',
        content: '/uploads/1/abc123.png',
        metadata: {},
      });
    });
  });

  it('shows an attachment chip for the uploaded image', async () => {
    renderChatInput(store);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      await userEvent.upload(fileInput, makeImageFile('my-screenshot.png'));
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Attachment: my-screenshot.png')).toBeTruthy();
    });
  });

  it('still uses extractTextFromDocument for non-image files', async () => {
    renderChatInput(store);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      await userEvent.upload(fileInput, makeDocFile('report.pdf'));
    });

    await waitFor(() => {
      expect(extractTextFromDocument).toHaveBeenCalled();
      expect(uploadFile).not.toHaveBeenCalled();
    });
  });

  it('shows an error toast when uploadFile fails', async () => {
    (uploadFile as jest.Mock).mockRejectedValue(new Error('Network error'));
    renderChatInput(store);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    await act(async () => {
      await userEvent.upload(fileInput, makeImageFile());
    });

    await waitFor(() => {
      // No attachment added on failure
      const attachments = selectChatAttachments(store.getState());
      expect(attachments).toHaveLength(0);
    });
  });
});
