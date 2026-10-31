// Saving a generated file: through the artifact viewer's `downloads` capability when the
// page is hosted on claude.ai, otherwise with an ordinary browser download.

export type SaveOutcome = 'saved' | 'declined' | 'busy' | 'unavailable';

interface DownloadsNs {
  save(req: { filename: string; data: Blob | string }): Promise<{ status: string }>;
}
interface ClaudeHost {
  use(name: string): Promise<unknown>;
}

const isFramed = () => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
};

export async function saveFile(filename: string, data: Blob): Promise<SaveOutcome> {
  const host = (window as unknown as { claude?: ClaudeHost }).claude;
  if (host && typeof host.use === 'function') {
    const downloads = (await host.use('downloads').catch(() => null)) as DownloadsNs | null;
    if (downloads) {
      try {
        await downloads.save({ filename, data });
        return 'saved';
      } catch (e) {
        const code = (e as { code?: string })?.code;
        if (code === 'declined') return 'declined';
        if (code === 'rate_limited') return 'busy';
        return 'unavailable';
      }
    }
  }
  if (isFramed()) return 'unavailable';
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'saved';
}

export function saveMessage(outcome: SaveOutcome, what: string): string {
  switch (outcome) {
    case 'saved':
      return `${what} saved`;
    case 'declined':
      return 'Download cancelled';
    case 'busy':
      return 'Another download is waiting for confirmation. Try again in a moment.';
    default:
      return 'Saving files is not available in this view. Open the app on its own page or run it locally.';
  }
}

export const safeName = (s: string) => s.replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').slice(0, 60) || 'cable';
