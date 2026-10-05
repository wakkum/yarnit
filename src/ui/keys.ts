// Shortcut labels for the user's platform. The shortcuts themselves accept Cmd or Ctrl everywhere
// (App.tsx); only what we print differs: Mac uses symbols, Windows and Linux spell keys out.

export type KeyLabels = { mod: string; shift: string; alt: string; del: string; sep: string };

export function keyLabels(mac: boolean): KeyLabels {
  return mac
    ? { mod: '⌘', shift: '⇧', alt: '⌥', del: '⌫', sep: '' }
    : { mod: 'Ctrl', shift: 'Shift', alt: 'Alt', del: 'Del', sep: '+' };
}

const platform =
  typeof navigator === 'undefined'
    ? ''
    : ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
      navigator.platform ??
      navigator.userAgent);

export const isMac = /Mac|iPhone|iPad/i.test(platform);
export const KEYS = keyLabels(isMac);

/** A key combo as the user should read it, e.g. combo('shift', 'mod', 'Z') -> "⇧⌘Z" or "Shift+Ctrl+Z". */
export const combo = (...parts: string[]) => comboWith(KEYS, ...parts);

export function comboWith(labels: KeyLabels, ...parts: string[]) {
  const named: Record<string, string> = { mod: labels.mod, shift: labels.shift, alt: labels.alt, del: labels.del };
  return parts.map((p) => named[p] ?? p).join(labels.sep);
}
