import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type { RoomSettings } from '@/net/lobbyProtocol';
import { WorkerMatches } from '../server/workerMatches';

const state = vi.hoisted(() => ({
  workers: [] as (EventEmitter & { terminate: ReturnType<typeof vi.fn> })[],
}));
vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await import('node:events');
  return {
    Worker: class extends EventEmitter {
      terminate = vi.fn(async () => 0);
      postMessage = vi.fn();
      constructor() {
        super();
        state.workers.push(this);
      }
    },
  };
});

const settings: RoomSettings = {
  name: 'check',
  map: 'persia',
  mode: 'zone',
  size: 8,
  lineup: 'usersBots',
  difficulty: 'normal',
  input: 'all',
  botShare: true,
  teamPick: 'random',
  chat: false,
  simple: false,
};
afterEach(() => {
  vi.useRealTimers();
  state.workers.length = 0;
});

describe('room worker lifecycle', () => {
  it.each(['error', 'exit', 'failed'])(
    'a running worker %s returns the room to the lobby once',
    async (how) => {
      vi.useFakeTimers();
      const ended = vi.fn();
      const matches = new WorkerMatches({ ended });
      const started = matches.start('room', settings, []);
      const worker = state.workers.at(-1)!;
      worker.emit('message', { t: 'loaded' });
      await started;
      if (how === 'error') worker.emit('error', new Error('tick failed'));
      else if (how === 'failed') worker.emit('message', { t: 'failed', error: 'tick failed' });
      else worker.emit('exit', 1);
      worker.emit('exit', 1);
      await vi.runAllTimersAsync();
      expect(matches.running).toBe(0);
      expect(ended).toHaveBeenCalledExactlyOnceWith('room');
      matches.dispose();
    },
  );

  it('a deliberately stopped worker does not end its replacement match', async () => {
    vi.useFakeTimers();
    const ended = vi.fn();
    const matches = new WorkerMatches({ ended });
    const first = matches.start('room', settings, []);
    const old = state.workers.at(-1)!;
    old.emit('message', { t: 'loaded' });
    await first;
    const second = matches.start('room', settings, []);
    const next = state.workers.at(-1)!;
    next.emit('message', { t: 'loaded' });
    await second;
    old.emit('exit', 1);
    old.emit('message', { t: 'ended' });
    await vi.runAllTimersAsync();
    expect(matches.running).toBe(1);
    expect(ended).not.toHaveBeenCalled();
    matches.dispose();
  });
});
