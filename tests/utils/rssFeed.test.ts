jest.mock('dns/promises', () => ({
  __esModule: true,
  default: {
    lookup: jest.fn(),
  },
}));

import dns from 'dns/promises';
import { fetchFeed } from '../../src/utils/rssFeed';

const mockLookup = (dns as any).lookup as jest.Mock;

const RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example Feed</title>
    <link>https://example.com</link>
    <description>Example</description>
    <item>
      <title>Item One</title>
      <link>https://example.com/item-1</link>
      <guid>item-1</guid>
    </item>
  </channel>
</rss>`;

describe('fetchFeed SSRF safety + domain handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  test('allows normal public domain hostnames', async () => {
    mockLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    (global.fetch as jest.Mock).mockResolvedValue(
      new Response(RSS_XML, {
        status: 200,
        headers: { 'content-type': 'application/rss+xml' },
      }),
    );

    const result = await fetchFeed(
      {
        sourceType: 'rss',
        url: 'https://hnrss.org/frontpage',
        route: null,
      },
      {
        timeoutMs: 5000,
        maxBodyBytes: 1024 * 1024,
      },
    );

    expect(result.notModified).toBe(false);
    expect(result.items.length).toBeGreaterThan(0);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('rejects a private literal host address', async () => {
    await expect(
      fetchFeed(
        {
          sourceType: 'rss',
          url: 'http://127.0.0.1/feed.xml',
          route: null,
        },
        {
          timeoutMs: 5000,
          maxBodyBytes: 1024 * 1024,
        },
      ),
    ).rejects.toThrow('Feed host resolves to a private or loopback address');

    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('rejects domains that resolve to private addresses', async () => {
    mockLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);

    await expect(
      fetchFeed(
        {
          sourceType: 'rss',
          url: 'https://evil-proxy.example/feed.xml',
          route: null,
        },
        {
          timeoutMs: 5000,
          maxBodyBytes: 1024 * 1024,
        },
      ),
    ).rejects.toThrow('Feed host resolves to a private or loopback address');

    expect(global.fetch).not.toHaveBeenCalled();
  });
});
