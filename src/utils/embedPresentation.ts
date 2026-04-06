export function joinCompactFooterParts(parts: Array<string | null | undefined | false>): string {
  return parts
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' • ');
}

export function formatCompactPageIndicator(pageNumber: number, totalPages: number): string | null {
  if (totalPages <= 1) return null;
  return `${pageNumber}/${totalPages} ◄►`;
}

export function trimFooterPrompt(text: string): string {
  const [firstSegment = ''] = text.split(/\s*[•·]\s*/u, 1);
  return firstSegment.trim();
}

export function compactEmbedDescription(
  description: string | string[] | undefined,
  fallback = 'No description provided.',
): string {
  const lines = (Array.isArray(description) ? description : (description ?? '').split('\n'))
    .flatMap((line) => String(line).split('\n'))
    .map((line) => line.trim())
    .filter(Boolean);

  const firstLine = lines[0];
  if (!firstLine) return fallback;

  const firstSentence = firstLine.match(/^.+?[.!?](?=\s|$)/u)?.[0];
  return (firstSentence ?? firstLine).trim();
}
