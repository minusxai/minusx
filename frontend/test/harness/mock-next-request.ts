/**
 * Lightweight MockNextRequest for testing
 *
 * NextRequest is heavy with internal Next.js state and body streams.
 * This mock implements only what handlers need, avoiding memory leaks.
 */

export class MockNextRequest {
  private bodyData: any;
  public headers: Headers;
  public method: string;
  public url: string;

  constructor(url: string, init?: { method?: string; body?: string; headers?: any }) {
    this.url = url;
    this.method = init?.method || 'POST';
    this.headers = new Headers(init?.headers || {});

    // Parse body once and store
    if (init?.body) {
      try {
        this.bodyData = JSON.parse(init.body);
      } catch {
        this.bodyData = init.body;
      }
    }
  }

  // Implement the json() method that handlers use
  async json(): Promise<any> {
    return this.bodyData;
  }

  // Implement other methods if needed
  async text(): Promise<string> {
    return typeof this.bodyData === 'string'
      ? this.bodyData
      : JSON.stringify(this.bodyData);
  }
}
