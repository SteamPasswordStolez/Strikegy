import { SIGNAL_VERSION, type ClientMsg, type Device, type ErrorCode, type IceServer, type ServerMsg } from './signalProtocol';

type Handlers = {
  [K in ServerMsg['t']]: (msg: Extract<ServerMsg, { t: K }>) => void;
} & { close: () => void };

export class SignalError extends Error {
  constructor(
    readonly code: ErrorCode | 'connect',
    detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

/** The browser's end of the signalling WebSocket: hello, then typed messages both ways. */
export class SignalClient {
  private readonly listeners = new Map<keyof Handlers, Set<(msg: ServerMsg) => void>>();
  id = '';
  name = '';
  ice: IceServer[] = [];

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener('message', (e) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(e.data)) as ServerMsg;
      } catch {
        return;
      }
      this.listeners.get(msg.t)?.forEach((fn) => fn(msg));
    });
    ws.addEventListener('close', () => this.listeners.get('close')?.forEach((fn) => (fn as () => void)()));
  }

  /** Connects to the first server that answers and says hello. */
  static async connect(urls: readonly string[], hello: { name: string; uid: string; device: Device }): Promise<SignalClient> {
    let last: unknown = new SignalError('connect', 'no server');
    for (const url of urls) {
      try {
        const ws = await open(url);
        const client = new SignalClient(ws);
        const welcome = await client.request({ t: 'hello', v: SIGNAL_VERSION, ...hello }, 'welcome');
        client.id = welcome.id;
        client.name = welcome.name;
        client.ice = welcome.ice;
        return client;
      } catch (err) {
        last = err;
      }
    }
    throw last;
  }

  get open(): boolean {
    return this.ws.readyState === WebSocket.OPEN;
  }

  on<K extends keyof Handlers>(t: K, fn: Handlers[K]): () => void {
    let set = this.listeners.get(t);
    if (!set) this.listeners.set(t, (set = new Set()));
    const f = fn as unknown as (msg: ServerMsg) => void;
    set.add(f);
    return () => void set.delete(f);
  }

  send(msg: ClientMsg): void {
    if (this.open) this.ws.send(JSON.stringify(msg));
  }

  /** Sends and waits for the answer of a kind (or an error, which rejects). */
  request<K extends ServerMsg['t']>(msg: ClientMsg, answer: K, timeoutMs = 8000): Promise<Extract<ServerMsg, { t: K }>> {
    return new Promise((resolve, reject) => {
      const done = (): void => {
        offOk();
        offErr();
        offClose();
        clearTimeout(timer);
      };
      const offOk = this.on(answer, ((m: Extract<ServerMsg, { t: K }>) => {
        done();
        resolve(m);
      }) as Handlers[K]);
      const offErr = this.on('error', (m) => {
        done();
        reject(new SignalError(m.code, m.detail));
      });
      const offClose = this.on('close', () => {
        done();
        reject(new SignalError('connect', 'closed'));
      });
      const timer = setTimeout(() => {
        done();
        reject(new SignalError('connect', 'timeout'));
      }, timeoutMs);
      this.send(msg);
    });
  }

  close(): void {
    this.ws.close();
  }
}

function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new SignalError('connect', 'timeout'));
    }, 5000);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new SignalError('connect', url));
    });
  });
}
