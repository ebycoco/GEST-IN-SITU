import React, { useState } from 'react';
import { UserCircle, Shield, Mail, Phone, Lock, Save, AlertTriangle, Eye, EyeOff, FileText, Download, CloudDownload } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import toast from 'react-hot-toast';

export default function ProfilePage() {
  const handleExportLogs = async () => {
    try {
      const res = await window.api.app.exportLogs();
      if (res.success) {
        toast.success(`Fichier de diagnostic exporté avec succès vers le Bureau !`, {
          duration: 6000,
          style: {
            background: '#12131e',
            color: '#fff',
            border: '2px solid #10b981',
            borderRadius: '16px',
          }
        });
      } else if (res.canceled) {
        toast.error("Exportation annulée par l'utilisateur.");
      } else {
        toast.error(`Erreur d'exportation : ${res.error}`);
      }
    } catch (err: any) {
      toast.error(`Erreur système : ${err.message || err}`);
    }
  };

  const [isExportingDb, setIsExportingDb] = useState(false);

  const handleExportDatabase = async () => {
    setIsExportingDb(true);
    try {
      const res = await window.api.database.export(user);
      if (res.success) {
        toast.success(`Base de données exportée avec succès !`, {
          duration: 6000,
          style: {
            background: '#12131e',
            color: '#fff',
            border: '2px solid #10b981',
            borderRadius: '16px',
          }
        });
      } else if (res.reason === 'cancelled') {
        toast.error("Exportation annulée par l'utilisateur.");
      } else {
        toast.error(`Erreur d'exportation : ${res.reason}`);
      }
    } catch (err: any) {
      toast.error(`Erreur système : ${err.message || err}`);
    } finally {
      setIsExportingDb(false);
    }
  };
  const user = useAuthStore(s => s.user);
  const isSuperAdmin = user?.role === 'SUPER ADMIN';

  const [nom, setNom] = useState(user?.nom_user || '');
  const [prenom, setPrenom] = useState(user?.prenom_user || '');
  const [email, setEmail] = useState((user as any)?.email || '');
  const formatPhoneString = (value: string): string => {
    let input = value;
    if (!input.startsWith('+225 ')) {
      input = '+225 ';
    }
    const localPart = input.slice(5);
    const digitsOnly = localPart.replace(/\D/g, '');
    const truncatedDigits = digitsOnly.slice(0, 10);
    const formattedParts = truncatedDigits.match(/.{1,2}/g);
    const formattedLocal = formattedParts ? formattedParts.join(' ') : '';
    return `+225 ${formattedLocal}`;
  };

  const [telephone, setTelephone] = useState(() => {
    const rawVal = (user as any)?.telephone || '';
    if (!rawVal) return '+225 ';
    // Formater la valeur existante
    let cleanDigits = rawVal.replace(/\D/g, '');
    if (cleanDigits.startsWith('225')) {
      cleanDigits = cleanDigits.slice(3);
    }
    const truncated = cleanDigits.slice(0, 10);
    const parts = truncated.match(/.{1,2}/g);
    const formattedLocal = parts ? parts.join(' ') : '';
    return `+225 ${formattedLocal}`;
  });

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [autoDownstream, setAutoDownstream] = useState(false);
  const [isLoadingSyncPref, setIsLoadingSyncPref] = useState(true);

  React.useEffect(() => {
    if (user?.login) {
      window.api.sync.getAutoDownstream(user.login).then(val => {
        setAutoDownstream(val);
        setIsLoadingSyncPref(false);
      }).catch(err => {
        console.error("Failed to fetch auto downstream preference", err);
        setIsLoadingSyncPref(false);
      });
    }
  }, [user?.login]);

  const handleToggleAutoDownstream = async () => {
    if (!user?.login) return;
    try {
      const newVal = !autoDownstream;
      const res = await window.api.sync.setAutoDownstream(user.login, newVal);
      if (res.success) {
        setAutoDownstream(newVal);
        toast.success(`Récupération automatique ${newVal ? 'activée' : 'désactivée'}.`);
      } else {
        toast.error("Erreur lors de l'enregistrement de la préférence.");
      }
    } catch (e: any) {
      toast.error(`Erreur système : ${e.message}`);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSuperAdmin) return;

    if (password && password !== confirmPassword) {
      toast.error('Les mots de passe ne correspondent pas.');
      return;
    }

    if (!email.trim()) {
      toast.error("L'adresse e-mail est obligatoire.");
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      toast.error("Veuillez entrer une adresse e-mail valide (ex: utilisateur@domaine.com).");
      return;
    }

    const cleanPhone = telephone.replace(/\s+/g, '');
    if (cleanPhone) {
      if (!cleanPhone.startsWith('+')) {
        toast.error("Le numéro de téléphone doit commencer par '+' suivi de l'indicatif pays.");
        return;
      }
      if (cleanPhone.startsWith('+225') && cleanPhone.replace(/\D/g, '').length !== 13) {
        toast.error("Le numéro de téléphone pour la Côte d'Ivoire (+225) doit comporter exactement 10 chiffres locaux.");
        return;
      }
      if (cleanPhone.replace(/\D/g, '').length < 8) {
        toast.error("Le numéro de téléphone saisi est trop court.");
        return;
      }
    }

    setIsSaving(true);
    try {
      const data: any = {
        nom_user: nom.trim(),
        prenom_user: prenom.trim(),
        email: email.trim(),
        telephone: cleanPhone
      };
      if (password) {
        data.password = password;
      }

      await window.api.auth.updateSelfProfile(user!.id_user, data);

      // Mettre à jour le store global
      useAuthStore.setState({
        user: {
          ...user!,
          nom_user: nom.trim(),
          prenom_user: prenom.trim(),
          email: email.trim(),
          telephone: cleanPhone
        } as any
      });

      toast.success('Profil mis à jour avec succès !', {
        duration: 5000,
        style: {
          background: '#12131e',
          color: '#fff',
          border: '2px solid #fbbf24',
          borderRadius: '16px',
        }
      });

      setPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      toast.error('Erreur: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: '6rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <UserCircle size={20} color="var(--accent-primary)" />
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Mon Profil</h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24, maxWidth: 1000 }}>
        
        {/* Fiche récapitulative de l'agent */}
        <div className="card" style={{ background: 'var(--premium-glass)', border: '1px solid rgba(255,255,255,0.05)', display: 'flex', flexDirection: 'column', gap: 24, padding: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ width: 80, height: 80, borderRadius: 20, background: 'var(--gradient-button)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, fontWeight: 700, color: 'white', flexShrink: 0 }}>
              {(nom || user?.login || 'U').slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h3 style={{ fontSize: 20, margin: '0 0 4px 0', color: 'white', fontWeight: 800 }}>{prenom} {nom}</h3>
              <p style={{ color: 'var(--text-muted)', margin: 0 }}>@{user?.login}</p>
              <span className="badge badge-primary" style={{ marginTop: 8, display: 'inline-block', fontSize: 10, fontWeight: 800 }}>{user?.role}</span>
            </div>
          </div>

          <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Identifiant unique (Login)</span>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'white', marginTop: 4 }}>@{user?.login}</div>
            </div>
            <div>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Rôle système</span>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'white', marginTop: 4 }}>{user?.role}</div>
            </div>

            {/* Maintenance & Diagnostics */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 20, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Maintenance & Diagnostics</span>
              
              <button
                type="button"
                onClick={handleExportLogs}
                className="btn btn-secondary text-xs"
                style={{
                  width: '100%',
                  borderRadius: 12,
                  padding: '10px 16px',
                  fontWeight: 700,
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: 'white',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  transition: 'all 0.2s'
                }}
              >
                <Download size={16} color="var(--accent-primary)" />
                Exporter les logs de diagnostic
              </button>

              {(isSuperAdmin || user?.role === 'ADMINISTRATEUR_SITE') && (
                <button
                  type="button"
                  onClick={handleExportDatabase}
                  disabled={isExportingDb}
                  className="btn btn-secondary text-xs"
                  style={{
                    width: '100%',
                    borderRadius: 12,
                    padding: '10px 16px',
                    fontWeight: 700,
                    backgroundColor: 'rgba(99, 102, 241, 0.05)',
                    border: '1px solid rgba(99, 102, 241, 0.2)',
                    color: 'white',
                    cursor: isExportingDb ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    transition: 'all 0.2s'
                  }}
                >
                  <Download size={16} color="#818cf8" />
                  {isExportingDb ? 'Exportation...' : 'Exporter la base locale'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Formulaire de modification */}
        <div className="card" style={{ background: 'var(--premium-glass)', border: '1px solid rgba(255,255,255,0.05)', padding: 32 }}>
          {isSuperAdmin ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '200px', gap: 16, textAlign: 'center' }}>
              <div style={{ width: 48, height: 48, borderRadius: 16, background: 'rgba(251, 191, 36, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <AlertTriangle size={24} color="#fbbf24" />
              </div>
              <div>
                <h4 style={{ margin: 0, fontSize: 16, color: 'white', fontWeight: 700 }}>Modification restreinte</h4>
                <p style={{ margin: '8px 0 0 0', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5 }}>
                  La modification autonome du profil Super Administrateur est désactivée dans cette interface pour des raisons de sécurité globale.
                </p>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <h3 style={{ margin: 0, fontSize: 18, color: 'white', fontWeight: 800 }}>Mettre à jour mes informations</h3>
              
              <div style={{ display: 'flex', gap: 16 }}>
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>Prénom</label>
                  <input 
                    className="form-input" 
                    type="text" 
                    value={prenom} 
                    onChange={e => setPrenom(e.target.value)} 
                    style={{ width: '100%', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', height: 44, color: 'white', padding: '0 16px', outline: 'none' }} 
                    required 
                  />
                </div>
                
                <div className="form-group" style={{ flex: 1 }}>
                  <label className="form-label" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>Nom</label>
                  <input 
                    className="form-input" 
                    type="text" 
                    value={nom} 
                    onChange={e => setNom(e.target.value)} 
                    style={{ width: '100%', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', height: 44, color: 'white', padding: '0 16px', outline: 'none' }} 
                    required 
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>Adresse Email</label>
                <div style={{ position: 'relative' }}>
                  <Mail size={16} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input 
                    className="form-input" 
                    type="email" 
                    value={email} 
                    onChange={e => setEmail(e.target.value)} 
                    style={{ width: '100%', paddingLeft: 44, borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', height: 44, color: 'white', outline: 'none' }} 
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>Téléphone</label>
                <div style={{ position: 'relative' }}>
                  <Phone size={16} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input 
                    className="form-input" 
                    type="text" 
                    value={telephone} 
                    onChange={e => setTelephone(formatPhoneString(e.target.value))} 
                    style={{ width: '100%', paddingLeft: 44, borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', height: 44, color: 'white', outline: 'none' }} 
                  />
                </div>
              </div>

              <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '12px 0 0 0' }} />

              <div className="form-group">
                <label className="form-label" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>Nouveau mot de passe (laisser vide si inchangé)</label>
                <div style={{ position: 'relative' }}>
                  <Lock size={16} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input 
                    className="form-input" 
                    type={showPassword ? 'text' : 'password'} 
                    value={password} 
                    onChange={e => setPassword(e.target.value)} 
                    placeholder="••••••••"
                    style={{ width: '100%', paddingLeft: 44, paddingRight: 44, borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', height: 44, color: 'white', outline: 'none' }} 
                  />
                  <button 
                    type="button" 
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0
                    }}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label" style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, display: 'block' }}>Confirmer le nouveau mot de passe</label>
                <div style={{ position: 'relative' }}>
                  <Lock size={16} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input 
                    className="form-input" 
                    type={showConfirmPassword ? 'text' : 'password'} 
                    value={confirmPassword} 
                    onChange={e => setConfirmPassword(e.target.value)} 
                    placeholder="••••••••"
                    style={{ width: '100%', paddingLeft: 44, paddingRight: 44, borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)', height: 44, color: 'white', outline: 'none' }} 
                  />
                  <button 
                    type="button" 
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    style={{
                      position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0
                    }}
                  >
                    {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                <button 
                  type="submit" 
                  className="btn btn-primary" 
                  disabled={isSaving}
                  style={{ 
                    borderRadius: 12, 
                    padding: '0 24px', 
                    height: 44, 
                    fontWeight: 800, 
                    background: 'var(--gradient-primary)', 
                    boxShadow: '0 8px 16px rgba(99, 102, 241, 0.3)', 
                    transition: 'all 0.3s', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 8, 
                    border: 'none',
                    color: 'white',
                    cursor: isSaving ? 'not-allowed' : 'pointer'
                  }}
                >
                  <Save size={16} />
                  {isSaving ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Carte Préférences de Synchronisation */}
        <div className="card" style={{ background: 'var(--premium-glass)', border: '1px solid rgba(255,255,255,0.05)', padding: 32, display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(99, 102, 241, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CloudDownload size={20} color="var(--accent-primary)" />
            </div>
            <h3 style={{ margin: 0, fontSize: 18, color: 'white', fontWeight: 800 }}>Préférences de Synchronisation</h3>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <h4 style={{ margin: 0, fontSize: 14, color: 'white', fontWeight: 600 }}>Récupération Automatique</h4>
                <p style={{ margin: '4px 0 0 0', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5 }}>
                  Dès la connexion, l'application récupère automatiquement les cartes depuis le cloud. Cette option est sauvegardée pour cet utilisateur.
                </p>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', cursor: isLoadingSyncPref ? 'not-allowed' : 'pointer', opacity: isLoadingSyncPref ? 0.5 : 1 }}>
                <div style={{
                  position: 'relative',
                  width: 44,
                  height: 24,
                  backgroundColor: autoDownstream ? 'var(--accent-primary)' : 'rgba(255, 255, 255, 0.1)',
                  borderRadius: 24,
                  transition: 'background-color 0.3s'
                }}>
                  <div style={{
                    position: 'absolute',
                    top: 2,
                    left: autoDownstream ? 22 : 2,
                    width: 20,
                    height: 20,
                    backgroundColor: 'white',
                    borderRadius: '50%',
                    transition: 'left 0.3s, transform 0.3s',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
                  }} />
                </div>
                <input 
                  type="checkbox" 
                  checked={autoDownstream} 
                  onChange={handleToggleAutoDownstream} 
                  disabled={isLoadingSyncPref}
                  style={{ display: 'none' }} 
                />
              </label>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
