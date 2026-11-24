import type { Magasin } from '../src/lib/stockageSession';

/** Faux sessionStorage (Storage minimal). */
export function fauxMagasin(): Magasin & { dump(): Record<string, string> } {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}
