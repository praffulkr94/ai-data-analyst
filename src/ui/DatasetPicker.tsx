import { useRef, useState } from 'react';
import type { Loader } from '../data/loader';
import { MAX_BYTES, WARN_BYTES } from '../data/loader';
import { SAMPLES } from '../data/samples';
import { useApp } from '../store';

/** The first-run surface: a sample is offered before anything is asked of the visitor, so the
    app can be seen working before they invest a file or a key.

    First run only. Once a Dataset is loaded the switcher in the header is what changes it
    (ADR-0027), and a load in progress is `LoadStage` — which is why the progress card that used
    to live here does not any more. */
export function DatasetPicker({ loader }: { loader: Loader }) {
  const load = useApp((s) => s.load);
  const restore = useApp((s) => s.restore);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  /** The rows of an upload are unrecoverable across a reload, so a link built on one names the
      file and asks for it back. A file with a different name warns and loads anyway — it is far
      more often a renamed copy than a different Dataset, and the semantic validator is what
      decides whether the analysis still holds. */
  const wanted = restore?.ref.kind === 'upload' ? restore.ref : null;
  const take = (file: File) =>
    void loader.loadFile(
      file,
      wanted && file.name !== wanted.filename
        ? `This link was built on ${wanted.filename}, and you picked ${file.name}.`
        : undefined,
    );

  return (
    <div
      className={over ? 'stage drop-target' : 'stage'}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files[0];
        if (file) take(file);
      }}
    >
      <h1>Ask a question about a table</h1>
      <p className="notice-body" style={{ margin: '0 0 22px', maxWidth: 600 }}>
        You type a question in plain English. A language model translates it into a query
        specification; this application computes the answer and draws the chart. The model never
        sees a row of your data — <span style={{ color: 'var(--text)' }}>the rows never leave the
        browser</span>.
      </p>

      {wanted && (
        <p className="notice notice-warning" role="status" style={{ marginBottom: 12 }}>
          This link was built on <code>{wanted.filename}</code>
          {wanted.rowCount > 0 && <> ({wanted.rowCount.toLocaleString()} rows)</>}. Rows are never
          written to storage, so re-select it to restore the analysis.{' '}
          <button type="button" className="link" onClick={() => input.current?.click()}>
            Choose the file
          </button>
        </p>
      )}
      {load.status === 'failed' && (
        <p className="notice notice-error" role="alert" style={{ marginBottom: 12 }}>
          {load.message}
        </p>
      )}

      <section className="card">
        <div className="strip">
          <span>Start with a sample</span>
        </div>
        <ul>
          {SAMPLES.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="list-row tall"
                onClick={() => void loader.loadSample(s)}
              >
                <span className="label">
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontWeight: 500 }}>{s.label}</span>
                    <span className="muted">{s.rowCount.toLocaleString()} rows</span>
                  </span>
                  <span className="sub">{s.note}</span>
                </span>
                <span className="chevron" aria-hidden="true">
                  &rsaquo;
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="picker-foot">
          <span className="drop-hint">Drop a CSV anywhere on this panel</span>
          <button type="button" onClick={() => input.current?.click()}>
            Pick a file…
          </button>
        </div>
      </section>

      <p className="muted" style={{ margin: '12px 0 0', fontSize: 'var(--text-xs)' }}>
        Warns at {mb(WARN_BYTES)} MB · hard cap {mb(MAX_BYTES)} MB · rows capped at 500,000 with a
        truncation banner. Malformed rows never fail the file. A few example values per column go
        to the model when you ask a question; whole rows never do.
      </p>

      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        className="visually-hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) take(file);
        }}
      />
    </div>
  );
}

const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);
