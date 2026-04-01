/**
 * Discord reaction routes require the emoji segment to be URL-encoded.
 * Unicode: encode the grapheme(s). Custom: use name:id (also encoded).
 */
export function encodeReactionForRoute(emoji: string): string {
  const s = String(emoji).trim();
  if (!s) return s;
  const mention = /^<a?:([\w]+):(\d+)>$/.exec(s);
  if (mention) {
    return encodeURIComponent(`${mention[1]}:${mention[2]}`);
  }
  const colon = /^(a:)?([\w]+):(\d+)$/.exec(s);
  if (colon) {
    return encodeURIComponent(`${colon[2]}:${colon[3]}`);
  }
  return encodeURIComponent(s.replace(/[\uFE00-\uFE0F\u200D]/g, '').trim());
}
