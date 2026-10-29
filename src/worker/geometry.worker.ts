import { generateBoxes } from '../geometry/generate';
import type { BoxResult, MiniInput, Settings } from '../types';

export interface WorkerRequest {
  id: number;
  groupName: string;
  minis: MiniInput[];
  settings: Settings;
}

export type WorkerResponse =
  | { type: 'progress'; id: number; message: string; fraction: number }
  | { type: 'result'; id: number; boxes: BoxResult[] }
  | { type: 'error'; id: number; message: string };

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(msg: WorkerResponse, transfer?: Transferable[]): void;
};

ctx.onmessage = (e) => {
  const { id, groupName, minis, settings } = e.data;
  try {
    const boxes = generateBoxes(groupName, minis, settings, (message, fraction) =>
      ctx.postMessage({ type: 'progress', id, message, fraction }),
    );
    const transfer = boxes.flatMap((b) => [b.box.buffer, b.lid.buffer]) as ArrayBuffer[];
    ctx.postMessage({ type: 'result', id, boxes }, transfer);
  } catch (err) {
    ctx.postMessage({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
  }
};
