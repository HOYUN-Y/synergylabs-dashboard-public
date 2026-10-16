import { brainApi } from './api';
import type { FullGraph } from './model';

/** 지도와 그 실행 상태 조회는 같은 요청 수명을 사용한다. 취소를 무시하는 응답도 반영하지 않는다. */
export function createBrainLoader(handlers: {
  loading(): void;
  ready(graph: FullGraph): void;
  error(message: string): void;
}, load = brainApi.graph) {
  let current: AbortController | null = null;
  const isCurrent = (signal: AbortSignal | undefined): signal is AbortSignal =>
    !!signal && current?.signal === signal && !signal.aborted;
  return {
    get signal() { return current?.signal; },
    isCurrent,
    cancel() { current?.abort(); },
    async reload(force = true) {
      current?.abort();
      const controller = new AbortController();
      current = controller;
      handlers.loading();
      try {
        const graph = await load(controller.signal, force);
        if (isCurrent(controller.signal)) handlers.ready(graph);
      } catch (error) {
        if (isCurrent(controller.signal)) {
          controller.abort();
          handlers.error(error instanceof Error ? error.message : '세컨드 브레인을 읽지 못했습니다.');
        }
      }
    }
  };
}
