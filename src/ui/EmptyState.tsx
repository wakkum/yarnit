import { useRef, useState } from 'react';
import { useStore } from '../state/store';

const MODELS = [
  { id: 'Xenova/whisper-tiny.en', label: 'Fastest (tiny, English)', size: '~40 MB' },
  { id: 'Xenova/whisper-base.en', label: 'Balanced (base, English)', size: '~80 MB' },
  { id: 'Xenova/whisper-small.en', label: 'Most accurate (small, English)', size: '~250 MB' },
  { id: 'Xenova/whisper-base', label: 'Multilingual (base)', size: '~80 MB' },
];

export function EmptyState() {
  const settings = useStore((s) => s.settings);
  const phase = useStore((s) => s.phase);
  const message = useStore((s) => s.message);
  const { loadFile, setSettings } = useStore.getState();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const model = MODELS.find((m) => m.id === settings.model);

  // decoding a new file or reopening a saved project: no drop zone to click meanwhile
  if (phase === 'decoding')
    return (
      <div className="empty">
        <p className="muted">{message}…</p>
      </div>
    );

  return (
    <div className="empty">
      <div
        className={`drop${over ? ' over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files[0];
          if (f) void loadFile(f);
        }}
      >
        <h1>Drop an audio file to start</h1>
        <p>
          MP3, WAV or M4A. It is transcribed and edited on this computer: nothing is uploaded. The first time, the
          speech model ({model?.size}) downloads once and is then kept by your browser.
        </p>
        <button className="primary" onClick={() => input.current?.click()}>
          Choose audio file
        </button>
        <input
          ref={input}
          type="file"
          accept="audio/*"
          hidden
          onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])}
        />
        {phase === 'error' && <p className="status-error" style={{ marginTop: 16 }}>{message}</p>}
        <div className="settings">
          <label>
            Speech model
            <select
              value={settings.model}
              onChange={(e) => setSettings({ model: e.target.value, language: e.target.value.endsWith('.en') ? '' : 'english' })}
            >
              {MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Engine
            <select value={settings.device} onChange={(e) => setSettings({ device: e.target.value as 'wasm' | 'webgpu' })}>
              <option value="wasm">Standard (WASM)</option>
              <option value="webgpu">GPU (WebGPU, experimental)</option>
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}
