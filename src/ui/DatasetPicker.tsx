import { useRef, useState } from 'react';
import type { Loader } from '../data/loader';
import { SAMPLES } from '../data/samples';
import { useApp } from '../store';

/** The first-run surface: a sample is offered before anything is asked of the visitor, so the
    app can be seen working before they invest a file or a key. */
export function DatasetPicker({ loader }: { loader: Loader }) {
  const load = useApp((s) => s.load);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  if (load.status === 'loading') {
    return (
      <section className="panel centred">
        <h1>Loading {load.label}</h1>
        <p className="muted" aria-live="polite">
          {load.rows.toLocaleString()} rows parsed — the interface stays responsive throughout.
        </p>
        {load.warning && (
          <p className="notice notice-warning" role="status">
            {load.warning}
          </p>
        )}
        <button type="button" className="ghost" onClick={() => loader.cancel()}>
          Cancel
        </button>
      </section>
    );
  }

  return (
    <section
      className={`panel centred${over ? ' drop-target' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files[0];
        if (file) void loader.loadFile(file);
      }}
    >
      <h1>Ask a question about a table</h1>
      <p className="muted">
        The model translates your question into a specification. The application checks it,
        executes it, and draws the chart. Your rows never leave the browser.
      </p>
      {load.status === 'failed' && (
        <p className="notice notice-error" role="alert">
          {load.message}
        </p>
      )}
      <ul className="sample-list">
        {SAMPLES.map((s) => (
          <li key={s.id}>
            <button type="button" className="primary" onClick={() => void loader.loadSample(s)}>
              {s.label}
              <span className="muted"> · {s.rowCount.toLocaleString()} rows</span>
            </button>
            <span className="muted sample-note">{s.note}</span>
          </li>
        ))}
      </ul>
      <p className="muted">
        Or drop a CSV anywhere on this panel —{' '}
        <button type="button" className="link" onClick={() => input.current?.click()}>
          pick a file
        </button>
        . A few example values per column go to the model when you ask a question; whole rows
        never do.
      </p>
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        className="visually-hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void loader.loadFile(file);
        }}
      />
    </section>
  );
}
