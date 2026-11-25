import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { defineClientState } from '../../state';
import { oneSheetAtATime, type Sheet } from './sheets';

function makeSheets(client: QueryClient) {
  const closed: string[] = [];
  const sheet = (name: string): Sheet & { name: string } => {
    const open = defineClientState<boolean>(`test.sheet.${name}`, false, { client });
    return {
      name,
      open,
      close: () => {
        closed.push(name);
        open.set(false);
      },
    };
  };
  return { settings: sheet('settings'), trip: sheet('trip'), search: sheet('search'), closed };
}

describe('oneSheetAtATime', () => {
  it('closes the open sheet (through its own close) when another one opens', () => {
    const { settings, trip, search, closed } = makeSheets(new QueryClient());
    const stop = oneSheetAtATime([settings, trip, search]);

    trip.open.set(true);
    expect(closed).toEqual([]);

    settings.open.set(true);
    expect(trip.open.get()).toBe(false);
    expect(settings.open.get()).toBe(true);
    expect(closed).toEqual(['trip']);

    search.open.set(true);
    expect(settings.open.get()).toBe(false);
    expect(search.open.get()).toBe(true);
    expect(closed).toEqual(['trip', 'settings']);
    stop();
  });

  it('does nothing on close, or for sheets that are already closed', () => {
    const { settings, trip, search, closed } = makeSheets(new QueryClient());
    const stop = oneSheetAtATime([settings, trip, search]);
    settings.open.set(true);
    settings.open.set(false);
    expect(closed).toEqual([]);
    stop();
  });

  it('stops coordinating after unsubscribe', () => {
    const { settings, trip, search } = makeSheets(new QueryClient());
    const stop = oneSheetAtATime([settings, trip, search]);
    stop();
    trip.open.set(true);
    settings.open.set(true);
    expect(trip.open.get()).toBe(true);
  });
});
