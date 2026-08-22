/** Loading a Dataset. Lives outside React and writes the store directly, which is the specific
    reason the store exists at all (DECISIONS §12). */
import { useApp } from '../store';
import type { ColumnType } from '../engine/types';
import type { DataPort } from '../worker/port';
import type { JobId } from '../worker/protocol';
import { sampleRef, sampleUrl, type Sample } from './samples';

/** Above the cap the tab cannot hold the Dataset, so we refuse rather than hang. */
export const MAX_BYTES = 50 * 1024 * 1024;

export type Loader = ReturnType<typeof createLoader>;

export function createLoader(port: DataPort) {
  const app = useApp;
  let current: JobId | null = null;

  port.onCrash((message) => {
    current = null;
    app.getState().failLoad(`${message} Re-select the Dataset to carry on.`);
  });

  async function run(source: Parameters<DataPort['send']>[0], label: string): Promise<void> {
    app.getState().beginLoad(label);
    const call = port.send(source, (m) => {
      if (m.type === 'parse:progress' && m.jobId === current) app.getState().reportProgress(m.rows);
    });
    current = call.jobId;
    let res;
    try {
      res = await call.done;
    } catch (e) {
      app.getState().failLoad(e instanceof Error ? e.message : String(e));
      return;
    }
    // Latest-wins: a Dataset the visitor has since replaced must not land.
    if (res.jobId !== current) return;
    current = null;
    if (res.type === 'parse:done') app.getState().setDataset(res.handle, res.report);
    else if (res.type === 'error') app.getState().failLoad(res.message);
  }

  return {
    loadSample: (sample: Sample) =>
      run(
        {
          type: 'parse',
          source: { url: sampleUrl(sample) },
          ref: sampleRef(sample),
          label: sample.label,
        },
        sample.label,
      ),

    loadFile(file: File): Promise<void> {
      if (file.size > MAX_BYTES) {
        app
          .getState()
          .failLoad(
            `${file.name} is ${mb(file.size)}MB. The cap is ${mb(MAX_BYTES)}MB — above that the ` +
              `tab cannot hold the Dataset, so refusing beats hanging.`,
          );
        return Promise.resolve();
      }
      if (!/\.(csv|tsv|txt)$/i.test(file.name) && file.type !== 'text/csv') {
        app.getState().failLoad(`${file.name} is not a CSV.`);
        return Promise.resolve();
      }
      return run(
        {
          type: 'parse',
          source: { file },
          ref: { kind: 'upload', filename: file.name, rowCount: 0 },
          label: file.name,
        },
        file.name,
      );
    },

    /** Re-encode one column under a type the visitor chose. */
    async retype(column: string, columnType: ColumnType): Promise<void> {
      app.getState().setColumnType(column, columnType);
      const res = await port.send({ type: 'retype', column, columnType }).done;
      if (res.type === 'retype:done') {
        app.getState().setDataset(res.handle, app.getState().parseReport);
      } else if (res.type === 'error') {
        app.getState().failLoad(res.message);
      }
    },

    cancel(): void {
      if (current !== null) port.cancel(current);
      current = null;
    },
  };
}

const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);
