// The same scheduler handles browser visibility and is stopped when its page is hidden.
export function startDashboardPolling(
  refresh: () => void,
  interval: number,
  lastSuccess?: { current: number },
  visibility: Pick<Document, 'hidden' | 'addEventListener' | 'removeEventListener'> = document
) {
  let timer: ReturnType<typeof setInterval> | undefined;
  const check = (force = false) => {
    if (!visibility.hidden && (force || !lastSuccess || !lastSuccess.current || Date.now() - lastSuccess.current >= interval)) refresh();
  };
  const resume = () => {
    clearInterval(timer);
    if (!visibility.hidden) { check(); timer = setInterval(() => check(true), interval); }
  };
  visibility.addEventListener('visibilitychange', resume);
  resume();
  return () => { clearInterval(timer); visibility.removeEventListener('visibilitychange', resume); };
}
