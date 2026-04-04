import { uploadSlackFile } from '@/lib/integrations/slack/api';

describe('uploadSlackFile', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);

      if (url.startsWith('https://slack.com/api/files.getUploadURLExternal')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, upload_url: 'https://uploads.slack.test/file', file_id: 'F_TEST_FILE' }),
        } as Response;
      }

      if (url === 'https://uploads.slack.test/file') {
        return {
          ok: true,
          status: 200,
          text: async () => '',
        } as Response;
      }

      if (url === 'https://slack.com/api/files.completeUploadExternal') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, files: [{ id: 'F_TEST_FILE' }] }),
        } as Response;
      }

      throw new Error(`Unexpected fetch URL: ${url} (${JSON.stringify(init ?? {})})`);
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('uploads file and associates with channel via completeUploadExternal', async () => {
    const result = await uploadSlackFile('xoxb-test', {
      channel: 'C123',
      filename: 'chart.png',
      fileData: Buffer.from('png-bytes'),
    });

    expect(result).toEqual({ fileId: 'F_TEST_FILE' });

    const fetchMock = global.fetch as jest.MockedFunction<typeof fetch>;
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const completeCall = fetchMock.mock.calls[2];
    expect(String(completeCall[0])).toBe('https://slack.com/api/files.completeUploadExternal');
    expect(JSON.parse(String(completeCall[1]?.body))).toEqual({
      files: [{ id: 'F_TEST_FILE', title: 'chart.png' }],
      channel_id: 'C123',
    });
  });
});
