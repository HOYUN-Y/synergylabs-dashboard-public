import { ImapFlow } from 'imapflow';
import type { MailInput, MailMessage } from '../../shared/api.js';
import { MailError } from './errors.js';

type Client = Pick<ImapFlow, 'connect' | 'mailboxOpen' | 'fetchAll' | 'logout' | 'close' | 'on'>;
type ClientFactory = (input: MailInput) => Client;
export const createClient: ClientFactory = input => new ImapFlow({
  host: input.host, port: input.port, secure: input.security === 'tls',
  ...(input.security === 'starttls' ? { doSTARTTLS: true } : {}),
  auth: { user: input.username, pass: input.password },
  tls: { rejectUnauthorized: true }, logger: false, logRaw: false,
  disableAutoIdle: true, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000
});

export async function queryMail(input: MailInput, list: boolean, signal?: AbortSignal,
  factory: ClientFactory = createClient, timeoutMs = 20000): Promise<MailMessage[]> {
  const client = factory(input);
  const progress: { stage: 'connect' | 'mailbox' | 'fetch' } = { stage: 'connect' };
  let timer: ReturnType<typeof setTimeout>;
  let fail: (error: Error) => void = () => {};
  const abort = () => { fail(new MailError('CONFIG_CHANGED')); client.close(); };
  const failure = new Promise<never>((_resolve, reject) => {
    fail = reject;
    timer = setTimeout(() => { reject(new MailError('TIMEOUT')); client.close(); }, timeoutMs);
    client.on('error', reject);
  });
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const work = async () => {
    if (signal?.aborted) throw new MailError('CONFIG_CHANGED');
    await client.connect();
    progress.stage = 'mailbox';
    const mailbox = await client.mailboxOpen(input.mailbox, { readOnly: true });
    if (!mailbox.readOnly) throw new MailError('MAILBOX_FAILED');
    progress.stage = 'fetch';
    const messages: MailMessage[] = [];
    if (list && mailbox.exists > 0) {
      const items = await client.fetchAll(`${Math.max(1, mailbox.exists - 19)}:${mailbox.exists}`,
        { uid: true, envelope: true, internalDate: true, flags: true });
      for (const item of items.sort((a, b) => b.uid - a.uid).slice(0, 20)) {
        const date = item.internalDate ? new Date(item.internalDate) : null;
        messages.push({
          id: `${mailbox.uidValidity}:${item.uid}`,
          subject: item.envelope?.subject || '(제목 없음)',
          from: item.envelope?.from?.map(sender => sender.name
            ? `${sender.name}${sender.address ? ` <${sender.address}>` : ''}` : sender.address || '(발신자 없음)').join(', ') || '(발신자 없음)',
          receivedAt: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
          seen: item.flags?.has('\\Seen') ?? false
        });
      }
    }
    await client.logout();
    return messages;
  };
  try { return await Promise.race([work(), failure]); }
  catch (error) {
    if (error instanceof MailError) throw error;
    const e = error as { authenticationFailed?: boolean; code?: string };
    if (e.authenticationFailed) throw new MailError('AUTH_FAILED');
    if (/TLS|SSL|CERT|SELF_SIGNED|UNABLE_TO_VERIFY|STARTTLS/i.test(e.code ?? '')) throw new MailError('TLS_FAILED');
    if (/TIMEOUT|ETIMEDOUT/i.test(e.code ?? '')) throw new MailError('TIMEOUT');
    throw new MailError(progress.stage === 'mailbox' ? 'MAILBOX_FAILED' : 'CONNECTION_FAILED');
  } finally {
    clearTimeout(timer!);
    signal?.removeEventListener('abort', abort);
    client.close();
  }
}
