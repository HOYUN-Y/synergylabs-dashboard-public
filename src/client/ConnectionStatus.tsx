import { useEffect, useRef, useState } from 'react';
import { fmt } from './format';
import { IconButton } from './ui';
import { getHealth } from './api';

type Connection =
  | { status: 'checking' }
  | { status: 'connected'; time: string }
  | { status: 'failed'; message: string };

/** 머리줄의 서버 연결: 정상이면 점 하나(올리면 확인 시각), 끊기면 문구와 다시 확인 버튼(시안 .server) */
export function ConnectionStatus() {
  const [connection, setConnection] = useState<Connection>({ status: 'checking' });
  const [busy, setBusy] = useState(true);
  const activeRequest = useRef<AbortController | null>(null);

  async function check() {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setBusy(true);
    try {
      const health = await getHealth(controller.signal);
      if (!controller.signal.aborted) setConnection({ status: 'connected', time: health.time });
    } catch {
      if (!controller.signal.aborted) {
        setConnection({ status: 'failed', message: '서버 실행 상태를 확인한 뒤 다시 시도해 주세요.' });
      }
    } finally { if (activeRequest.current === controller) { activeRequest.current = null; setBusy(false); } }
  }

  useEffect(() => {
    void check();
    return () => activeRequest.current?.abort();
  }, []);

  const state = connection.status === 'connected' ? 'ok' : connection.status === 'failed' ? 'down' : 'checking';
  const label = connection.status === 'connected' ? `서버 연결됨 · ${fmt.time(connection.time)} 확인` : connection.status === 'failed' ? '서버 연결 끊김' : '서버 확인 중';
  return <div className="server" data-state={state} data-tip={connection.status === 'failed' ? connection.message : label}>
    <span className="dot" aria-hidden="true" />
    <span className="server__label" role="status" aria-live="polite">{label}</span>
    <IconButton icon="refresh" label="서버 다시 확인" tip="다시 확인" size="sm" className="server__retry" busy={busy} disabled={busy} onClick={() => void check()} />
  </div>;
}
