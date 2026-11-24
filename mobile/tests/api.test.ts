import { describe, expect, it, vi } from 'vitest';

// api.ts importe supabase-js et config (import.meta.env) : seule la logique pure
// classerErreur est testee ici ; le client n'est jamais cree (createClient non appele).
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

import { classerErreur } from '../src/lib/api';

describe('classerErreur', () => {
  it('status 0 (coupure, abandon, delai depasse) -> reseau', () => {
    expect(classerErreur(0, undefined)).toBe('reseau');
    expect(classerErreur(0, '', 'AbortError: signal is aborted without reason')).toBe('reseau');
    expect(classerErreur(0, '', 'TimeoutError: signal timed out')).toBe('reseau');
    // status 0 l'emporte sur tout code
    expect(classerErreur(0, '42501', 'session invalide')).toBe('reseau');
  });
  it('42501 « session invalide » -> session', () => {
    expect(classerErreur(403, '42501', 'session invalide')).toBe('session');
    expect(classerErreur(403, '42501', 'Session INVALIDE (jeton sans claims)')).toBe('session');
  });
  it('42501 autre message -> role', () => {
    expect(classerErreur(403, '42501', 'role non autorise')).toBe('role');
    expect(classerErreur(403, '42501')).toBe('role');
  });
  it('401 -> session', () => {
    expect(classerErreur(401, undefined)).toBe('session');
    expect(classerErreur(401, 'XX000')).toBe('session');
  });
  it('PGRST301 / PGRST303 (jeton expire / invalide) -> session', () => {
    expect(classerErreur(401, 'PGRST301')).toBe('session');
    expect(classerErreur(400, 'PGRST301')).toBe('session');
    expect(classerErreur(401, 'PGRST303')).toBe('session');
  });
  it('55P03 (verrou de ligne) -> occupee', () => {
    expect(classerErreur(500, '55P03')).toBe('occupee');
  });
  it('autre -> serveur', () => {
    expect(classerErreur(500, 'XX000')).toBe('serveur');
    expect(classerErreur(400, 'PGRST202')).toBe('serveur');
    expect(classerErreur(503, undefined)).toBe('serveur');
  });
});
