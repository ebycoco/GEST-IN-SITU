import React, { useState } from 'react';
import { ShieldCheck, User as UserIcon, Lock, Type, Eye, EyeOff, Key } from 'lucide-react';
import toast from 'react-hot-toast';

/** Longueur minimale du mot de passe d'un SUPER ADMIN (identique à la règle serveur users.queries.ts). */
export const SUPER_ADMIN_PASSWORD_MIN_LENGTH = 12;

const LOGIN_PATTERN = /^[\p{L}\p{N}._@-]{3,64}$/u;

/** Retire le préfixe technique Electron des erreurs IPC pour n'afficher que le message métier. */
const cleanIpcError = (err: unknown): string => {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  return raw.replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, '').trim();
};

interface Props {
  onClose: () => void;
  /** Appelé après création réussie (la page recharge la liste). */
  onCreated: () => void;
}

const FIELD_STYLE: React.CSSProperties = {
  width: '100%', paddingLeft: 44, borderRadius: 16, background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.1)', height: 44, color: 'white', outline: 'none'
};
const LABEL_STYLE: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, display: 'block' };
const ICON_STYLE: React.CSSProperties = { position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--accent-primary)' };

/**
 * Modal de création d'un SUPER ADMIN, réservé au compte ROOT (affiché uniquement par AgentsPage
 * quand la session est ROOT ; le serveur — users:createSuperAdmin — reste l'autorité : session ROOT
 * + mot de passe ROOT revérifiés). Gabarit modal-adaptatif-terrain : header fixe, corps déroulant,
 * footer fixe, hauteur max 90vh (OK à 1366x768).
 * Sécurité mémoire : les mots de passe ne vivent que dans le state local du modal, sont vidés à
 * l'erreur de confirmation et à la fermeture (démontage) ; jamais journalisés ni ré-affichés.
 */
export default function CreateSuperAdminModal({ onClose, onCreated }: Props) {
  const [login, setLogin] = useState('');
  const [nom, setNom] = useState('');
  const [prenom, setPrenom] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [rootPassword, setRootPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const validate = (): string => {
    const l = login.trim();
    if (!LOGIN_PATTERN.test(l)) return "Identifiant invalide : 3 à 64 caractères (lettres, chiffres, . _ - @), sans espace.";
    if (!nom.trim()) return 'Le nom est obligatoire.';
    if (password.length < SUPER_ADMIN_PASSWORD_MIN_LENGTH) return `Le mot de passe doit contenir au moins ${SUPER_ADMIN_PASSWORD_MIN_LENGTH} caractères.`;
    if (password !== confirm) return 'Les deux mots de passe ne sont pas identiques.';
    if (!rootPassword) return 'Saisissez le mot de passe ROOT pour confirmer.';
    return '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const msg = validate();
    if (msg) { setError(msg); return; }
    setError('');
    setSubmitting(true);
    try {
      await window.api.users.createSuperAdmin({
        login: login.trim(),
        nom_user: nom.trim(),
        prenom_user: prenom.trim() || undefined,
        password,
        rootPassword
      });
      toast.success(`SUPER ADMIN @${login.trim()} créé avec succès.`);
      onCreated();
      onClose();
    } catch (err) {
      const m = cleanIpcError(err);
      setError(m || 'Création impossible.');
      setRootPassword('');
    } finally {
      setSubmitting(false);
    }
  };

  const toggle = (
    <button type="button" onClick={() => setShowPwd(v => !v)} data-testid="superadmin-toggle-password"
      title={showPwd ? 'Masquer les mots de passe' : 'Afficher les mots de passe'}
      style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 0 }}>
      {showPwd ? <EyeOff size={18} /> : <Eye size={18} />}
    </button>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(2, 4, 12, 0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}
      data-testid="superadmin-modal">
      <div style={{
        background: 'linear-gradient(145deg, rgba(45, 50, 85, 0.95) 0%, rgba(20, 22, 40, 0.98) 100%)',
        width: 'min(92vw, 560px)', maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
        borderRadius: 28, border: '1px solid rgba(255, 255, 255, 0.15)', boxShadow: '0 40px 80px rgba(0, 0, 0, 0.9)'
      }}>
        {/* Header fixe */}
        <div style={{ flexShrink: 0, padding: '20px 32px 10px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 14, background: 'rgba(99, 102, 241, 0.1)', border: '1px solid rgba(99, 102, 241, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <ShieldCheck size={22} color="var(--accent-primary)" />
          </div>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 22, color: 'white', fontWeight: 800 }}>Créer un SUPER ADMIN</h3>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>Compte global, sans site ni centre. Action réservée à ROOT.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }} autoComplete="off">
          {/* Corps défilant */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 32px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={LABEL_STYLE} htmlFor="sa-login">Identifiant (login) *</label>
              <div style={{ position: 'relative' }}>
                <UserIcon size={18} style={ICON_STYLE} />
                <input id="sa-login" data-testid="superadmin-login" className="form-input" style={FIELD_STYLE} type="text" autoComplete="off"
                  value={login} onChange={e => setLogin(e.target.value)} placeholder="ex: sa.abidjan" disabled={submitting} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                <label style={LABEL_STYLE} htmlFor="sa-nom">Nom *</label>
                <div style={{ position: 'relative' }}>
                  <Type size={18} style={{ ...ICON_STYLE, color: 'var(--text-muted)' }} />
                  <input id="sa-nom" data-testid="superadmin-nom" className="form-input" style={FIELD_STYLE} type="text" autoComplete="off"
                    value={nom} onChange={e => setNom(e.target.value.toUpperCase())} placeholder="NOM DE FAMILLE" disabled={submitting} />
                </div>
              </div>
              <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                <label style={LABEL_STYLE} htmlFor="sa-prenom">Prénom</label>
                <div style={{ position: 'relative' }}>
                  <Type size={18} style={{ ...ICON_STYLE, color: 'var(--text-muted)' }} />
                  <input id="sa-prenom" data-testid="superadmin-prenom" className="form-input" style={FIELD_STYLE} type="text" autoComplete="off"
                    value={prenom} onChange={e => setPrenom(e.target.value.toUpperCase())} placeholder="Prénoms" disabled={submitting} />
                </div>
              </div>
            </div>
            <div>
              <label style={LABEL_STYLE} htmlFor="sa-pwd">Mot de passe * (minimum {SUPER_ADMIN_PASSWORD_MIN_LENGTH} caractères)</label>
              <div style={{ position: 'relative' }}>
                <Lock size={18} style={ICON_STYLE} />
                <input id="sa-pwd" data-testid="superadmin-password" className="form-input" style={{ ...FIELD_STYLE, paddingRight: 44 }}
                  type={showPwd ? 'text' : 'password'} autoComplete="new-password"
                  value={password} onChange={e => setPassword(e.target.value)} disabled={submitting} />
                {toggle}
              </div>
              <div data-testid="superadmin-password-hint" style={{ fontSize: 12, marginTop: 4, color: password.length >= SUPER_ADMIN_PASSWORD_MIN_LENGTH ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                {password.length} / {SUPER_ADMIN_PASSWORD_MIN_LENGTH} caractères minimum
              </div>
            </div>
            <div>
              <label style={LABEL_STYLE} htmlFor="sa-confirm">Confirmer le mot de passe *</label>
              <div style={{ position: 'relative' }}>
                <Lock size={18} style={ICON_STYLE} />
                <input id="sa-confirm" data-testid="superadmin-password-confirm" className="form-input" style={FIELD_STYLE}
                  type={showPwd ? 'text' : 'password'} autoComplete="new-password"
                  value={confirm} onChange={e => setConfirm(e.target.value)} disabled={submitting} />
              </div>
            </div>
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 12 }}>
              <label style={LABEL_STYLE} htmlFor="sa-root">Mot de passe ROOT (confirmation) *</label>
              <div style={{ position: 'relative' }}>
                <Key size={18} style={{ ...ICON_STYLE, color: '#fbbf24' }} />
                <input id="sa-root" data-testid="superadmin-root-password" className="form-input" style={FIELD_STYLE}
                  type="password" autoComplete="off"
                  value={rootPassword} onChange={e => setRootPassword(e.target.value)} disabled={submitting} />
              </div>
            </div>
            {error && (
              <div role="alert" data-testid="superadmin-error" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', color: '#fca5a5', borderRadius: 12, padding: '10px 14px', fontSize: 13 }}>
                {error}
              </div>
            )}
          </div>

          {/* Footer fixe */}
          <div style={{ flexShrink: 0, padding: '12px 32px 20px', display: 'flex', gap: 12, justifyContent: 'flex-end', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <button type="button" className="btn btn-outline" data-testid="superadmin-cancel" onClick={onClose} disabled={submitting}
              style={{ borderRadius: 14, height: 44, padding: '0 24px', fontWeight: 600 }}>
              Annuler
            </button>
            <button type="submit" className="btn btn-primary" data-testid="superadmin-submit" disabled={submitting}
              style={{ borderRadius: 14, height: 44, padding: '0 24px', fontWeight: 700 }}>
              {submitting ? 'Création...' : 'Créer le SUPER ADMIN'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
