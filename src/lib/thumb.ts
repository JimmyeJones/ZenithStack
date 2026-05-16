export function thumbUrl(thumbPath: string | null): string | null {
  if (!thumbPath) return null;
  const name = thumbPath.split(/[\\/]/).pop()!;
  return `zenith://lib/thumbs/${encodeURIComponent(name)}`;
}
