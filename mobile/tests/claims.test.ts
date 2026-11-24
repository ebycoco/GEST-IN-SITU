import { describe, expect, it } from 'vitest';
import { decodeJwtPayload, isAllowedV1, readGisClaims } from '../src/lib/claims';

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => {
    const bytes = new TextEncoder().encode(JSON.stringify(o));
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.signature`;
}

const BASE = {
  role: 'authenticated',
  gis_v: 1,
  gis_sync_id: 'abc-123',
  gis_site_id: 1,
  gis_centre_id: 4,
  gis_primary_role: 'OPERATEUR_VERIFICATION',
  gis_roles: ['OPERATEUR_VERIFICATION'],
};

describe('claims gis_* du jeton', () => {
  it('decode le base64url (accents compris)', () => {
    expect(decodeJwtPayload(jwt({ nom: 'Délivrée' }))).toEqual({ nom: 'Délivrée' });
    expect(decodeJwtPayload('pas.un-jwt')).toBeNull();
    expect(decodeJwtPayload('a.!!!.c')).toBeNull();
  });
  it('lit site, centre, roles', () => {
    expect(readGisClaims(jwt(BASE))).toEqual({
      syncId: 'abc-123',
      siteId: 1,
      centreId: 4,
      primaryRole: 'OPERATEUR_VERIFICATION',
      roles: ['OPERATEUR_VERIFICATION'],
    });
  });
  it('jeton sans hook (gis_v absent) ou non authenticated : null', () => {
    const { gis_v: _v, ...sansV } = BASE;
    expect(readGisClaims(jwt(sansV))).toBeNull();
    expect(readGisClaims(jwt({ ...BASE, role: 'anon' }))).toBeNull();
    expect(readGisClaims(jwt({ ...BASE, gis_sync_id: '' }))).toBeNull();
  });
  it('v1 : OPERATEUR_VERIFICATION requis (principal ou secondaire) et un site', () => {
    expect(isAllowedV1(readGisClaims(jwt(BASE)))).toBe(true);
    expect(isAllowedV1(readGisClaims(jwt({ ...BASE, gis_primary_role: 'ADMIN_CENTRE', gis_roles: ['ADMIN_CENTRE', 'OPERATEUR_VERIFICATION'] })))).toBe(true);
    expect(isAllowedV1(readGisClaims(jwt({ ...BASE, gis_roles: ['OPERATEUR_RECHERCHE'] })))).toBe(false);
    expect(isAllowedV1(readGisClaims(jwt({ ...BASE, gis_site_id: null })))).toBe(false);
    expect(isAllowedV1(null)).toBe(false);
  });
  it('centre absent : null (affiche « Sans centre »)', () => {
    expect(readGisClaims(jwt({ ...BASE, gis_centre_id: null }))?.centreId).toBeNull();
  });
});
