/** Binary (1024-based) byte formatter for storage figures shown to users. */
export function formatBytes(bytes: number | string): string {
  const value = typeof bytes === 'string' ? Number(bytes) : bytes;
  if (!Number.isFinite(value) || value <= 0) return '0 KB';
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.max(1, Math.round(value / 1024))} KB`;
}
