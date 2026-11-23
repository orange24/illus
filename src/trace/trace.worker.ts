import { traceImage, type TraceImage, type TraceOptions } from './tracer';

self.onmessage = (e: MessageEvent<{ id: number; image: TraceImage; opts: TraceOptions }>) => {
  const { id, image, opts } = e.data;
  try {
    const result = traceImage(image, opts);
    (self as unknown as Worker).postMessage({ id, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: (err as Error).message || String(err) });
  }
};
