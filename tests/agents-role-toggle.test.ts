import { describe, it, expect } from 'vitest';
import {
  computeRoleToggle,
  ROLE_REQUIRED_MESSAGE,
  ROLE_VISIBLE_REQUIRED_MESSAGE,
} from '../src/renderer/src/pages/agentsRoleToggle';

/**
 * Formulaire Agents (AgentsPage.toggleRole) : calcul pur des rôles et du rôle principal
 * après un clic sur une case. Cas visé : compte historique portant SUPER ADMIN en rôle
 * secondaire (aucune case SUPER ADMIN à l'écran).
 */
describe('computeRoleToggle — SUPER ADMIN secondaire caché', () => {
  it('décocher le principal avec SUPER ADMIN placé avant : le remplaçant est le premier rôle restant hors SUPER ADMIN', () => {
    const r = computeRoleToggle(['OPERATEUR_SAISIE', 'SUPER ADMIN', 'OPERATEUR_QUALITE'], 'OPERATEUR_SAISIE', 'OPERATEUR_SAISIE');
    expect(r).toEqual({ ok: true, roles: ['SUPER ADMIN', 'OPERATEUR_QUALITE'], role: 'OPERATEUR_QUALITE' });
  });

  it('décocher le principal quand il ne reste que SUPER ADMIN : refus, rien ne change', () => {
    const roles = ['OPERATEUR_SAISIE', 'SUPER ADMIN'];
    const r = computeRoleToggle(roles, 'OPERATEUR_SAISIE', 'OPERATEUR_SAISIE');
    expect(r).toEqual({ ok: false, error: ROLE_VISIBLE_REQUIRED_MESSAGE });
    expect(roles).toEqual(['OPERATEUR_SAISIE', 'SUPER ADMIN']); // entrée non mutée
  });

  it('décocher un rôle non principal avec SUPER ADMIN secondaire : principal conservé', () => {
    const r = computeRoleToggle(['OPERATEUR_SAISIE', 'SUPER ADMIN', 'OPERATEUR_QUALITE'], 'OPERATEUR_SAISIE', 'OPERATEUR_QUALITE');
    expect(r).toEqual({ ok: true, roles: ['OPERATEUR_SAISIE', 'SUPER ADMIN'], role: 'OPERATEUR_SAISIE' });
  });

  it('SUPER ADMIN principal (compte SA légitime) : décocher son secondaire reste permis', () => {
    const r = computeRoleToggle(['SUPER ADMIN', 'OPERATEUR_SAISIE'], 'SUPER ADMIN', 'OPERATEUR_SAISIE');
    expect(r).toEqual({ ok: true, roles: ['SUPER ADMIN'], role: 'SUPER ADMIN' });
  });
});

describe('computeRoleToggle — sans SUPER ADMIN (comportement inchangé)', () => {
  it('cocher un rôle : ajouté en fin, principal conservé', () => {
    expect(computeRoleToggle(['OPERATEUR_VERIFICATION'], 'OPERATEUR_VERIFICATION', 'OPERATEUR_SAISIE'))
      .toEqual({ ok: true, roles: ['OPERATEUR_VERIFICATION', 'OPERATEUR_SAISIE'], role: 'OPERATEUR_VERIFICATION' });
  });

  it('décocher le principal : le premier rôle restant le remplace', () => {
    expect(computeRoleToggle(['OPERATEUR_SAISIE', 'OPERATEUR_QUALITE', 'ADMIN_CENTRE'], 'OPERATEUR_SAISIE', 'OPERATEUR_SAISIE'))
      .toEqual({ ok: true, roles: ['OPERATEUR_QUALITE', 'ADMIN_CENTRE'], role: 'OPERATEUR_QUALITE' });
  });

  it('décocher un rôle non principal : principal conservé', () => {
    expect(computeRoleToggle(['OPERATEUR_SAISIE', 'OPERATEUR_QUALITE'], 'OPERATEUR_QUALITE', 'OPERATEUR_SAISIE'))
      .toEqual({ ok: true, roles: ['OPERATEUR_QUALITE'], role: 'OPERATEUR_QUALITE' });
  });

  it('décocher le dernier rôle : refus « Au moins un rôle est requis. »', () => {
    expect(computeRoleToggle(['OPERATEUR_SAISIE'], 'OPERATEUR_SAISIE', 'OPERATEUR_SAISIE'))
      .toEqual({ ok: false, error: ROLE_REQUIRED_MESSAGE });
    expect(ROLE_REQUIRED_MESSAGE).toBe('Au moins un rôle est requis.');
  });
});
