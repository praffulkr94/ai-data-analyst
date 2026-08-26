/** The key dialog.

    The key is verified with a one-token call on the cheaper model **before** the mode flips, so a
    bad key fails here rather than halfway through an analysis, and the message says the key was
    rejected rather than blaming the network. It is held in memory only — never `localStorage`,
    never the URL hash — and it survives a switch back to Demo so a visitor can toggle without
    re-pasting. */
import { useEffect, useRef, useState } from 'react';
import { hasApiKey, setApiKey, verifyKey } from '../ai/anthropic';
import { useApp } from '../store';

export function KeyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const setMode = useApp((s) => s.setMode);
  const ref = useRef<HTMLDialogElement>(null);
  const [key, setKey] = useState('');
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({
    busy: false,
    error: null,
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  async function submit(): Promise<void> {
    setState({ busy: true, error: null });
    try {
      await verifyKey(key.trim());
    } catch (e) {
      setState({ busy: false, error: e instanceof Error ? e.message : String(e) });
      return;
    }
    setApiKey(key.trim());
    setKey('');
    setState({ busy: false, error: null });
    setMode('byok');
    onClose();
  }

  return (
    <dialog className="key-dialog" ref={ref} onCancel={onClose} onClose={onClose}>
      <div className="card-head">
        <h2>Use your own API key</h2>
        <p>
          The key is held in memory for this tab only. It is never written to storage and never
          put in the link. Requests go straight from this browser to the API — there is no server
          in between. A few example values per column go with each question so the model knows
          what your columns hold; your rows do not.
        </p>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk-ant-…"
          aria-label="API key"
          autoComplete="off"
          spellCheck={false}
        />
        {state.error && (
          <p className="rejected" role="alert">
            <strong>key rejected</strong> — verified with a one-token call before switching, so
            nothing was in flight. {state.error}
          </p>
        )}
      </div>
      <div className="dialog-foot">
        <button type="button" onClick={onClose}>
          {hasApiKey() ? 'Cancel' : 'Stay in Demo mode'}
        </button>
        <button
          type="button"
          className="primary"
          disabled={state.busy || key.trim() === ''}
          onClick={() => void submit()}
        >
          {state.busy ? 'Checking…' : 'Verify and switch'}
        </button>
      </div>
    </dialog>
  );
}
