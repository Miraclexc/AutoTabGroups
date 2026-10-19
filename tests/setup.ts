import { beforeEach, vi } from 'vitest';

// Every test is offline by default. Provider tests explicitly install a fake fetch.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Tests must never call a real model or network endpoint'); }));
});
