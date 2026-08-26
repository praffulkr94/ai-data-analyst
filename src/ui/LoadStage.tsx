/** The surface a load owns while it is running, and the one a fatal failure leaves behind.

    It comes before every other branch in `App`, which is the point: a switch used to leave the
    Dataset being replaced on screen — its analyses, its row count, its chart — until the new one
    landed, and then blanked it. Whatever is happening, the surface behind it is about to stop
    being true, so it is not what should be on screen while it happens.

    The progress card was already drawn, inside `DatasetPicker`, and reachable only on first run.
    It lives here now and both paths use it. */
import type { Loader } from '../data/loader';
import { useApp } from '../store';
import type { Workspace } from '../workspace/workspace';
import { DatasetMenu } from './DatasetMenu';

export function LoadStage({ loader, workspace }: { loader: Loader; workspace: Workspace }) {
  const load = useApp((s) => s.load);

  if (load.status === 'loading') {
    return (
      <div className="stage narrow">
        <section className="card" style={{ padding: '18px 18px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
            <span className="spinner" aria-hidden="true" />
            <strong>Loading {load.label}</strong>
            <span style={{ flex: 1 }} />
            <button type="button" onClick={() => loader.cancel()}>
              Cancel
            </button>
          </div>
          {/* The total is unknown until the file ends, so the bar paces itself against the row
              count rather than claiming a percentage it cannot know. */}
          <div className="progress">
            <div style={{ width: `${Math.min(97, Math.log10(load.rows + 1) * 20)}%` }} />
          </div>
          <p className="composer-foot" aria-live="polite">
            <span className="mode-note">{load.rows.toLocaleString()} rows parsed</span>
            <span>the interface stays responsive — this is not a blocking spinner</span>
          </p>
          {load.warning && (
            <p className="notice notice-warning" role="status">
              {load.warning}
            </p>
          )}
        </section>
      </div>
    );
  }

  /** Only a failure the Dataset did not survive reaches here — the worker died. A refused file
      leaves everything as it was and is told in `LoadNews` instead, over a working workspace. */
  if (load.status === 'failed') {
    return (
      <div className="stage narrow">
        <section className="notice notice-critical" role="alert">
          <div className="notice-head">
            <span className="title">The Dataset is gone</span>
          </div>
          <p className="notice-body">{load.message}</p>
          <div style={{ display: 'flex', marginTop: 12 }}>
            <DatasetMenu workspace={workspace} className="plain-trigger">
              Choose a dataset
            </DatasetMenu>
          </div>
        </section>
      </div>
    );
  }

  return null;
}
