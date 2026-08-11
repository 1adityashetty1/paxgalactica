import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { ansi256ToHex } from '../color.js';

interface Playable {
  id: string;
  name: string;
  color: number;
  doctrine: string;
}

export function FactionPicker({
  onStart,
  onResume,
  onImport,
}: {
  onStart: (factionId: string) => void;
  onResume: (name: string) => void;
  onImport: (file: File) => void | Promise<void>;
}) {
  const [factions, setFactions] = useState<Playable[]>([]);
  const [saves, setSaves] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api
      .factions()
      .then((r) => {
        setFactions(r.factions);
        setSaves(r.saves);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div className="picker">
      <h1>PAX GALACTICA</h1>
      <p className="tagline">
        Four sectors of the Outer Rim. Five powers. No authority worth the name.
      </p>

      {error && <p className="error">{error}</p>}

      {saves.length > 0 && (
        <div className="resume">
          <h2>Resume</h2>
          {saves.map((name) => (
            <button key={name} className="resume-btn" onClick={() => onResume(name)}>
              {name}
            </button>
          ))}
        </div>
      )}

      <div className="resume">
        <h2>Load an archive</h2>
        <p className="hint">
          A <code>.tar.gz</code> exported from any machine. It is verified by replaying its whole
          journal before it is loaded.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".gz,.tgz,.tar.gz,application/gzip"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            // Clear the input so re-picking the same file fires onChange again.
            e.target.value = '';
            if (file) void onImport(file);
          }}
        />
        <button className="resume-btn" onClick={() => fileRef.current?.click()}>
          Choose file…
        </button>
      </div>

      <h2>Choose your faction</h2>
      <div className="faction-cards">
        {factions.map((f) => (
          <button
            key={f.id}
            className="faction-card"
            style={{ borderColor: ansi256ToHex(f.color) }}
            onClick={() => onStart(f.id)}
          >
            <strong style={{ color: ansi256ToHex(f.color) }}>{f.name}</strong>
            <span>{f.doctrine}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
