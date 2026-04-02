import { createHash } from 'crypto';
import dns from 'dns/promises';
import net from 'net';
import { XMLParser } from 'fast-xml-parser';

export type FeedSourceType = 'rss' | 'rsshub';

export interface FeedTarget {
  sourceType: FeedSourceType;
  url: string | null;
  route: string | null;
}

export interface FetchFeedOptions {
  timeoutMs: number;
  maxBodyBytes: number;
  etag?: string | null;
  lastModified?: string | null;
  rsshubBaseUrl?: string;
  rsshubAccessKey?: string | null;
}

export interface FeedItem {
  key: string;
  title: string;
  link: string;
  description: string | null;
  publishedAt: Date | null;
  author: string | null;
  imageUrl: string | null;
}

export interface FetchedFeed {
  feedUrl: string;
  title: string | null;
  link: string | null;
  description: string | null;
  etag: string | null;
  lastModified: string | null;
  notModified: boolean;
  items: FeedItem[];
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  textNodeName: '#text',
});

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function readString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (value && typeof value === 'object') {
    const maybeText = (value as Record<string, unknown>)['#text'];
    if (typeof maybeText === 'string') {
      const trimmed = maybeText.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
  }

  return null;
}

function readDate(value: unknown): Date | null {
  const str = readString(value);
  if (!str) return null;
  const timestamp = Date.parse(str);
  if (Number.isNaN(timestamp)) return null;
  return new Date(timestamp);
}

function stripHtml(raw: string | null): string | null {
  if (!raw) return null;
  const text = raw
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 0 ? text : null;
}

function extractImageFromHtml(raw: string | null): string | null {
  if (!raw) return null;
  const match = raw.match(/<img[^>]*src=["']([^"']+)["'][^>]*>/i);
  if (!match) return null;
  const src = match[1].trim();
  return src.length > 0 ? src : null;
}

function extractLink(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (Array.isArray(value)) {
    for (const v of value) {
      const link = extractLink(v);
      if (link) return link;
    }
    return null;
  }

  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.href === 'string' && obj.href.trim().length > 0) {
      return obj.href.trim();
    }
    if (typeof obj.url === 'string' && obj.url.trim().length > 0) {
      return obj.url.trim();
    }
    return readString(obj['#text']);
  }

  return null;
}

function normalizeRoute(route: string): string {
  const trimmed = route.trim();
  if (trimmed.length === 0) {
    throw new Error('RSSHub route cannot be empty');
  }
  if (!trimmed.startsWith('/')) {
    throw new Error('RSSHub route must start with /');
  }
  if (trimmed.startsWith('//')) {
    throw new Error('RSSHub route must be a path, not a protocol URL');
  }
  return trimmed;
}

function resolveFeedUrl(target: FeedTarget, options: FetchFeedOptions): string {
  if (target.sourceType === 'rsshub') {
    const route = normalizeRoute(target.route ?? '');
    const base = new URL(options.rsshubBaseUrl || 'https://rsshub.app');
    const routeUrl = new URL(route, 'https://rsshub.local');

    const pathPrefix = base.pathname.replace(/\/$/, '');
    const finalPath = `${pathPrefix}${routeUrl.pathname}`.replace(/\/{2,}/g, '/');

    base.pathname = finalPath;
    for (const [key, value] of routeUrl.searchParams.entries()) {
      base.searchParams.set(key, value);
    }

    if (options.rsshubAccessKey && !base.searchParams.has('key') && !base.searchParams.has('code')) {
      base.searchParams.set('key', options.rsshubAccessKey);
    }

    return base.toString();
  }

  if (!target.url) {
    throw new Error('Feed URL is required for rss sourceType');
  }

  let parsed: URL;
  try {
    parsed = new URL(target.url);
  } catch {
    throw new Error('Feed URL is invalid');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Feed URL must use http or https');
  }

  return parsed.toString();
}

function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map((part) => parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return true;
  }

  if (parts[0] === 10) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 0) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
  if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true;
  if (parts[0] >= 224) return true;

  return false;
}

function isPrivateIPv6(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0];
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;

  if (normalized.startsWith('::ffff:')) {
    const v4 = normalized.substring('::ffff:'.length);
    if (net.isIP(v4) === 4) return isPrivateIPv4(v4);
  }

  return false;
}

function isPrivateAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 0) return false;
  if (family === 4) return isPrivateIPv4(address);
  if (family === 6) return isPrivateIPv6(address);
  return false;
}

async function assertSafeTarget(urlString: string): Promise<void> {
  const parsed = new URL(urlString);
  const hostname = parsed.hostname.toLowerCase();

  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('Feed host is not allowed');
  }

  if (isPrivateAddress(hostname)) {
    throw new Error('Feed host resolves to a private or loopback address');
  }

  try {
    const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    if (addresses.length === 0) {
      throw new Error('Feed host has no DNS records');
    }

    for (const entry of addresses) {
      if (isPrivateAddress(entry.address)) {
        throw new Error('Feed host resolves to a private or loopback address');
      }
    }
  } catch (err: any) {
    if (err?.message?.includes('private or loopback')) {
      throw err;
    }
    throw new Error(`Unable to resolve feed host: ${err?.message || 'DNS lookup failed'}`);
  }
}

async function readBodyWithLimit(response: Response, maxBodyBytes: number): Promise<string> {
  if (!response.body) {
    throw new Error('Feed response is empty');
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    received += value.byteLength;
    if (received > maxBodyBytes) {
      throw new Error(`Feed response exceeded max size of ${maxBodyBytes} bytes`);
    }

    chunks.push(value);
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
}

function makeItemKey(guid: string | null, link: string | null, title: string | null, publishedAt: Date | null): string {
  if (guid) return guid;
  if (link) return link;

  const hashInput = `${title ?? ''}|${publishedAt ? publishedAt.toISOString() : ''}`;
  return createHash('sha1').update(hashInput).digest('hex');
}

function parseRss2(xml: Record<string, unknown>): {
  title: string | null;
  link: string | null;
  description: string | null;
  items: FeedItem[];
} {
  const channel = (xml.rss as Record<string, unknown>)?.channel as Record<string, unknown> | undefined;
  if (!channel) {
    throw new Error('Invalid RSS 2.0 feed payload');
  }

  const items = toArray(channel.item as Record<string, unknown>[] | Record<string, unknown> | undefined)
    .map((item) => {
      const title = readString(item.title) ?? 'Untitled';
      const link = extractLink(item.link);
      if (!link) return null;

      const rawDescription = readString(item['content:encoded']) ?? readString(item.description);
      const description = stripHtml(rawDescription);
      const imageUrl =
        extractLink(item.enclosure) ||
        extractLink(item['media:content']) ||
        extractImageFromHtml(rawDescription);

      const publishedAt = readDate(item.pubDate) || readDate(item.isoDate) || readDate(item.published);
      const guid = readString(item.guid);
      const author = readString(item.author) || readString(item['dc:creator']);

      return {
        key: makeItemKey(guid, link, title, publishedAt),
        title,
        link,
        description,
        publishedAt,
        author,
        imageUrl,
      };
    })
    .filter((item): item is FeedItem => item !== null);

  return {
    title: readString(channel.title),
    link: extractLink(channel.link),
    description: stripHtml(readString(channel.description)),
    items,
  };
}

function parseAtom(xml: Record<string, unknown>): {
  title: string | null;
  link: string | null;
  description: string | null;
  items: FeedItem[];
} {
  const feed = xml.feed as Record<string, unknown> | undefined;
  if (!feed) {
    throw new Error('Invalid Atom feed payload');
  }

  const feedLink = (() => {
    const links = toArray(feed.link as unknown);
    for (const link of links) {
      if (link && typeof link === 'object' && (link as Record<string, unknown>).rel === 'alternate') {
        const href = extractLink(link);
        if (href) return href;
      }
    }
    return extractLink(feed.link);
  })();

  const items = toArray(feed.entry as Record<string, unknown>[] | Record<string, unknown> | undefined)
    .map((entry) => {
      const title = readString(entry.title) ?? 'Untitled';

      const link = (() => {
        const links = toArray(entry.link as unknown);
        for (const l of links) {
          if (l && typeof l === 'object' && (l as Record<string, unknown>).rel === 'alternate') {
            const href = extractLink(l);
            if (href) return href;
          }
        }
        return extractLink(entry.link);
      })();

      if (!link) return null;

      const rawDescription = readString(entry.content) ?? readString(entry.summary);
      const description = stripHtml(rawDescription);
      const publishedAt = readDate(entry.updated) || readDate(entry.published);
      const author = (() => {
        const authorObj = entry.author;
        if (authorObj && typeof authorObj === 'object') {
          return readString((authorObj as Record<string, unknown>).name) || readString((authorObj as Record<string, unknown>)['#text']);
        }
        return readString(authorObj);
      })();

      const guid = readString(entry.id);
      const imageUrl = extractImageFromHtml(rawDescription);

      return {
        key: makeItemKey(guid, link, title, publishedAt),
        title,
        link,
        description,
        publishedAt,
        author,
        imageUrl,
      };
    })
    .filter((item): item is FeedItem => item !== null);

  return {
    title: readString(feed.title),
    link: feedLink,
    description: stripHtml(readString(feed.subtitle)),
    items,
  };
}

function parseXmlFeed(xmlString: string): {
  title: string | null;
  link: string | null;
  description: string | null;
  items: FeedItem[];
} {
  let parsed: Record<string, unknown>;
  try {
    parsed = xmlParser.parse(xmlString) as Record<string, unknown>;
  } catch {
    throw new Error('Feed XML could not be parsed');
  }

  if (parsed.rss) return parseRss2(parsed);
  if (parsed.feed) return parseAtom(parsed);

  throw new Error('Unsupported feed format (expected RSS 2.0 or Atom)');
}

export async function fetchFeed(target: FeedTarget, options: FetchFeedOptions): Promise<FetchedFeed> {
  const feedUrl = resolveFeedUrl(target, options);
  await assertSafeTarget(feedUrl);

  const timeoutMs = Math.max(1000, options.timeoutMs || 10000);
  const maxBodyBytes = Math.max(16 * 1024, options.maxBodyBytes || 1024 * 1024);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const headers: Record<string, string> = {
    'User-Agent': 'FluxyRSS/2.0 (+https://fluxer.app)',
    Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1',
  };

  if (options.etag) headers['If-None-Match'] = options.etag;
  if (options.lastModified) headers['If-Modified-Since'] = options.lastModified;

  try {
    const response = await fetch(feedUrl, {
      method: 'GET',
      headers,
      signal: controller.signal,
      redirect: 'follow',
    });

    const etag = response.headers.get('etag');
    const lastModified = response.headers.get('last-modified');

    if (response.status === 304) {
      return {
        feedUrl,
        title: null,
        link: null,
        description: null,
        etag,
        lastModified,
        notModified: true,
        items: [],
      };
    }

    if (!response.ok) {
      throw new Error(`Feed request failed with status ${response.status}`);
    }

    const xml = await readBodyWithLimit(response, maxBodyBytes);
    const parsed = parseXmlFeed(xml);

    const deduped = new Map<string, FeedItem>();
    for (const item of parsed.items) {
      if (!deduped.has(item.key)) {
        deduped.set(item.key, item);
      }
    }

    return {
      feedUrl,
      title: parsed.title,
      link: parsed.link,
      description: parsed.description,
      etag,
      lastModified,
      notModified: false,
      items: Array.from(deduped.values()),
    };
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(`Feed request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
