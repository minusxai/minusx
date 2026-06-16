import { describe, it, expect } from 'vitest';
import { AppEventRegistry } from '../registry';

const tick = () => new Promise(r => setTimeout(r, 0));

describe('AppEventRegistry.subscribeAll', () => {
  it('receives every published event with (eventName, payload)', async () => {
    const reg = new AppEventRegistry();
    const seen: Array<[string, unknown]> = [];
    reg.subscribeAll((event, payload) => { seen.push([event, payload]); });

    reg.publish('error', { mode: 'org', source: 's', message: 'boom' });
    reg.publish('share:lead', { mode: 'org', fileId: 1, nonce: 'n', storyName: 'S', name: 'J', email: 'j@x.com', userEmail: 'j@x.com', folderPath: '/org' });
    await tick();

    expect(seen).toHaveLength(2);
    expect(seen[0][0]).toBe('error');
    expect(seen[1][0]).toBe('share:lead');
    expect(seen[1][1]).toMatchObject({ email: 'j@x.com' });
  });

  it('fires global handlers even when an event has NO specific subscribers', async () => {
    const reg = new AppEventRegistry();
    let got: string | null = null;
    reg.subscribeAll((event) => { got = event; });

    reg.publish('mcp:tool_call', { mode: 'org', sessionId: 'x', tool: 't' });
    await tick();

    expect(got).toBe('mcp:tool_call');
  });

  it('does not drop specific handlers when global handlers are present', async () => {
    const reg = new AppEventRegistry();
    let specific = 0; let global = 0;
    reg.subscribe('error', () => { specific++; });
    reg.subscribeAll(() => { global++; });

    reg.publish('error', { mode: 'org', source: 's', message: 'm' });
    await tick();

    expect(specific).toBe(1);
    expect(global).toBe(1);
  });
});
