import { useApp } from '../store';

/** The composer. The Question input and the token readout land in milestone 5; what exists now
    is the frame they sit in. */
export function Composer() {
  const ready = useApp((s) => s.load.status === 'ready');
  return (
    <footer className="composer">
      <input
        type="text"
        placeholder={ready ? 'Ask a question about this Dataset…' : 'Load a Dataset to ask a question'}
        disabled
        aria-label="Question"
      />
    </footer>
  );
}
