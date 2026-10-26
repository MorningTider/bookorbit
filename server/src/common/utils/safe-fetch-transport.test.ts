const transport = vi.hoisted(() => ({ agent: vi.fn(), proxy: vi.fn(), fetch: vi.fn() }));
vi.mock('undici', () => ({
  Agent: class {
    constructor(options: unknown) {
      transport.agent(options);
    }
    close() {
      return Promise.resolve();
    }
  },
  ProxyAgent: class {
    constructor(options: unknown) {
      transport.proxy(options);
    }
    close() {
      return Promise.resolve();
    }
  },
  fetch: transport.fetch,
}));
vi.mock('./ssrf.utils', () => ({
  ensureSafeUrl: (url: string) => Promise.resolve(new URL(url)),
  isPrivateOrLocalAddress: () => false,
  PrivateAddressException: class extends Error {},
}));
import { safeFetch, forgetDispatchers } from './safe-fetch';

describe('safeFetch file transport compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transport.fetch.mockImplementation(() => Promise.resolve(new Response('ok')));
  });
  afterEach(() => {
    forgetDispatchers();
  });
  it('uses separate pooled agents for normal and HTTP/1.1 downloads', async () => {
    await safeFetch('https://example.com/file', {}, { pinResolvedAddress: true });
    await safeFetch('https://example.com/file', {}, { pinResolvedAddress: true, http1Only: true });
    await safeFetch('https://example.com/other-file', {}, { pinResolvedAddress: true, http1Only: true });
    expect(transport.agent).toHaveBeenCalledTimes(2);
    expect(transport.agent.mock.calls[0][0]).not.toHaveProperty('allowH2');
    expect(transport.agent.mock.calls[1][0]).toMatchObject({ allowH2: false, connect: { lookup: expect.any(Function) } });
    expect(transport.fetch).toHaveBeenCalledTimes(3);
  });
  it('preserves a configured proxy and its checked DNS lookup in compatibility mode', async () => {
    await safeFetch('https://example.com/file', {}, { profile: { proxyUrl: 'http://proxy.example.com:8080' }, http1Only: true });
    expect(transport.proxy).toHaveBeenCalledWith(
      expect.objectContaining({ uri: 'http://proxy.example.com:8080', allowH2: false, connect: { lookup: expect.any(Function) } }),
    );
  });
});
