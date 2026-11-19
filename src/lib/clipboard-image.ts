export function canCopyImageToClipboard(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.clipboard?.write === 'function' &&
    typeof ClipboardItem !== 'undefined'
  );
}

export async function copyPngFileToClipboard(file: File): Promise<boolean> {
  if (!canCopyImageToClipboard()) return false;
  try {
    const blob = file.type === 'image/png' ? file : new Blob([await file.arrayBuffer()], { type: 'image/png' });
    const item = new ClipboardItem({ 'image/png': blob });
    await navigator.clipboard.write([item]);
    return true;
  } catch {
    return false;
  }
}
