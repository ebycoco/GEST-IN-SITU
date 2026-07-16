import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { Shield, Eye, EyeOff, Loader, Info } from 'lucide-react';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const { login: doLogin, isLoading, setActiveRole } = useAuthStore();
  const navigate = useNavigate();

  const [isPreloading, setIsPreloading] = useState(false);

  useEffect(() => {
    if (window.api.auth.isPreloadingUsers) {
      window.api.auth.isPreloadingUsers().then(setIsPreloading).catch(console.error);
    }
    if (window.api.auth.onPreloadStatus) {
      return window.api.auth.onPreloadStatus(setIsPreloading);
    }
  }, []);

  const [showRoleModal, setShowRoleModal] = useState(false);
  const [availableRoles, setAvailableRoles] = useState<string[]>([]);

  const getRoleLabel = (role: string) => {
    switch(role) {
      case 'SUPER ADMIN': return 'Super Administrateur';
      case 'ADMINISTRATEUR_SITE': return 'Administrateur de Site (Global)';
      case 'ADMIN_CENTRE': return 'Administrateur de Centre (Local)';
      case 'OPERATEUR_VERIFICATION': return 'Opérateur de Vérification (Recherche & Délivrance)';
      case 'OPERATEUR_SAISIE': return 'Opérateur de Saisie (Nouvelle Saisie)';
      case 'OPERATEUR_LOGISTIQUE': return 'Opérateur Logistique (Scan, Classement, Apurement)';
      case 'OPERATEUR_QUALITE': return 'Opérateur Qualité (Correction & Fusion)';
      default: return role;
    }
  };

  const proceedToDashboard = (user: any) => {
    toast.success('Bienvenue dans GESTION CARTES IN-SITU !');
    
    if (user?.role === 'OPERATEUR_VERIFICATION') {
      navigate('/verification/recherche');
    } else if (user?.role === 'OPERATEUR_SAISIE') {
      navigate('/dashboard');
    } else if (user?.role === 'OPERATEUR_QUALITE') {
      navigate('/qualite');
    } else if (user?.role === 'ADMIN_CENTRE') {
      navigate('/centre/dashboard');
    } else if (user?.role === 'OPERATEUR_LOGISTIQUE') {
      navigate('/inventaire');
    } else {
      navigate('/dashboard');
    }
  };

  const handleRoleSelection = (role: string) => {
    setActiveRole(role);
    setShowRoleModal(false);
    const updatedUser = useAuthStore.getState().user;
    proceedToDashboard(updatedUser);
  };

  const [showImportModal, setShowImportModal] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const handleImportDatabase = async () => {
    setShowImportModal(false);
    setIsImporting(true);
    const toastId = toast.loading("Préparation de l'importation...");
    try {
      const res = await window.api.database.import();
      if (res.success) {
        toast.success("Base de données importée avec succès ! Redémarrage...", { id: toastId });
      } else if (res.reason === 'cancelled') {
        toast.error("Importation annulée par l'utilisateur.", { id: toastId });
      } else if (res.reason === 'invalid_extension') {
        toast.error("Extension de fichier invalide. Requis: .db ou .sqlite", { id: toastId });
      } else if (res.reason === 'invalid_sqlite_header') {
        toast.error("Format de fichier SQLite invalide.", { id: toastId });
      } else {
        toast.error(`Échec de l'importation : ${res.reason}`, { id: toastId });
      }
    } catch (err: any) {
      toast.error(`Erreur : ${err.message || err}`, { id: toastId });
    } finally {
      setIsImporting(false);
    }
  };

  // États pour la première installation et la sécurité réseau
  const [isFirstLaunch, setIsFirstLaunch] = useState(false);
  const [isOnline, setIsOnline] = useState(window.navigator.onLine);
  const [setupStatus, setSetupStatus] = useState<'idle' | 'pulling' | 'success' | 'failed'>('idle');
  const [setupMessage, setSetupMessage] = useState('');

  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    if (window.api?.app?.getVersion) {
      window.api.app.getVersion().then(setAppVersion).catch(console.error);
    }
  }, []);

  useEffect(() => {
    // 1. Détection premier démarrage
    if (window.api?.app?.checkFirstLaunch) {
      window.api.app.checkFirstLaunch().then((res) => {
        if (res && res.isFirstLaunch) {
          setIsFirstLaunch(true);
          // Si déjà en ligne, initier directement la configuration
          if (window.navigator.onLine) {
            triggerFirstLaunchSetup();
          }
        }
      }).catch(console.error);
    }

    // 3. Écouteurs de connectivité
    const handleOnline = () => {
      setIsOnline(true);
      if (isFirstLaunch && setupStatus !== 'success' && setupStatus !== 'pulling') {
        triggerFirstLaunchSetup();
      }
      // Re-tenter en cas de reconnexion

    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Écouteur réseau optionnel via le moniteur IPC s'il existe
    let unsubscribeSync: (() => void) | undefined;
    if (window.api?.sync?.onStatusChanged) {
      unsubscribeSync = window.api.sync.onStatusChanged((status: any) => {
        const netState = status?.state === 'online' || status?.state === 'connected';
        setIsOnline(netState);
        if (netState && isFirstLaunch && setupStatus !== 'success' && setupStatus !== 'pulling') {
          triggerFirstLaunchSetup();
        }
      });
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (unsubscribeSync) unsubscribeSync();
    };
  }, [isFirstLaunch, setupStatus]);
  const triggerFirstLaunchSetup = async () => {
    setSetupStatus('pulling');
    setSetupMessage("🟡 Connexion établie — Téléchargement et configuration de la base de données...");
    try {
      // Pull global de la synchronisation de démarrage (site + centres + agents)
      const syncRes = await window.api.sync.forceGlobal();
      if (syncRes && syncRes.success) {
        const check = await window.api.app.checkFirstLaunch();
        if (!check.isFirstLaunch) {
          setSetupStatus('success');
          setSetupMessage("🟢 Configuration réussie — Vous pouvez maintenant vous connecter.");
          toast.success("Configuration initiale terminée !");
        } else {
          setSetupStatus('failed');
          setSetupMessage("🔴 Échec de la configuration — Aucun compte agent récupéré depuis Supabase.");
        }
      } else {
        setSetupStatus('failed');
        setSetupMessage("🔴 Échec de la configuration — Impossible de contacter le cloud Supabase.");
      }
    } catch (err: any) {
      console.error(err);
      setSetupStatus('failed');
      setSetupMessage("🔴 Échec de la configuration — Une erreur réseau est survenue lors de la configuration.");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!login.trim() || !password.trim()) {
      toast.error('Veuillez remplir tous les champs');
      return;
    }
    
    const success = await doLogin(login.trim(), password.trim());
    if (success) {
      const user = useAuthStore.getState().user;
      
      if (user?.roles && user.roles.length > 1) {
        setAvailableRoles(user.roles);
        setShowRoleModal(true);
      } else {
        proceedToDashboard(user);
      }
    } else {
      toast.error('Identifiants incorrects');
    }
  };

  return (
    <div className="login-page">
      <div className="login-card animate-slide-up">
        <div className="login-logo">
          <div style={{
            width: 72, height: 72, borderRadius: 16, margin: '0 auto',
            background: 'var(--gradient-button)', display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 32px rgba(108,99,255,0.3)'
          }}>
            <Shield size={36} color="white" />
          </div>
          <h1>GESTION CARTES IN-SITU</h1>
          <p>Système de Gestion des Cartes CMU</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* ─── BANDEAUX DE SÉCURITÉ PREMIER DÉMARRAGE ─── */}
          {isFirstLaunch && (
            <div 
              style={{
                padding: '12px 16px',
                borderRadius: '12px',
                fontSize: '13px',
                fontWeight: 600,
                lineHeight: '1.4',
                transition: 'all 0.3s ease',
                border: '1px solid transparent',
                ...(!isOnline ? {
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  color: '#fca5a5',
                  borderColor: 'rgba(239, 68, 68, 0.3)'
                } : setupStatus === 'pulling' ? {
                  backgroundColor: 'rgba(234, 179, 8, 0.15)',
                  color: '#fef08a',
                  borderColor: 'rgba(234, 179, 8, 0.3)'
                } : setupStatus === 'success' ? {
                  backgroundColor: 'rgba(34, 197, 94, 0.15)',
                  color: '#bbf7d0',
                  borderColor: 'rgba(34, 197, 94, 0.3)'
                } : {
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  color: '#fca5a5',
                  borderColor: 'rgba(239, 68, 68, 0.3)'
                })
              }}
            >
              {!isOnline ? (
                "🔴 Hors-ligne — Une connexion Internet est requise pour la première configuration de l'application."
              ) : (
                setupMessage || "🟡 Connexion établie — Préparation de la base de données..."
              )}
            </div>
          )}
          {/* ───────────────────────────────────────────── */}

          <div className="form-group">
            <label className="form-label">Identifiant</label>
            <input className="form-input" type="text" placeholder="Entrez votre identifiant"
              value={login} onChange={(e) => setLogin(e.target.value)} autoFocus />
          </div>

          <div className="form-group">
            <label className="form-label">Mot de passe</label>
            <div style={{ position: 'relative' }}>
              <input className="form-input" type={showPwd ? 'text' : 'password'}
                placeholder="Entrez votre mot de passe" style={{ width: '100%', paddingRight: 44 }}
                value={password} onChange={(e) => setPassword(e.target.value)} />
              <button type="button" onClick={() => setShowPwd(!showPwd)}
                style={{
                  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)'
                }}>
                {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button 
            type="submit" 
            className="btn btn-primary" 
            disabled={isLoading || (isFirstLaunch && setupStatus !== 'success') || isPreloading}
            style={{ width: '100%', justifyContent: 'center', padding: '12px 24px', marginTop: 8 }}
          >
            {isLoading || isPreloading ? <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> : null}
            {isPreloading ? 'Synchronisation des comptes...' : isLoading ? 'Connexion...' : 'Se connecter'}
          </button>
        </form>

        {/* Message informatif pour les zones isolées */}
        <div style={{
          marginTop: 20,
          padding: '12px',
          borderRadius: '8px',
          backgroundColor: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start'
        }}>
          <Info size={16} style={{ color: '#9ca3af', flexShrink: 0, marginTop: 2 }} />
          <p style={{ margin: 0, fontSize: '12px', color: '#9ca3af', lineHeight: 1.5 }}>
            <strong>Astuce :</strong> Si vous prévoyez de travailler en zone sans connexion, assurez-vous d'avoir ouvert l'application au moins une fois avec une connexion internet pour synchroniser vos accès.
          </p>
        </div>

        {/* Zone discrète d'importation technique */}
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center' }}>
          <button
            type="button"
            onClick={() => setShowImportModal(true)}
            disabled={isImporting}
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(255, 255, 255, 0.2)',
              fontSize: '11px',
              cursor: isImporting ? 'not-allowed' : 'pointer',
              textDecoration: 'underline',
              transition: 'color 0.2s',
            }}
            onMouseOver={(e) => { if (!isImporting) e.currentTarget.style.color = 'var(--accent-primary)'; }}
            onMouseOut={(e) => { if (!isImporting) e.currentTarget.style.color = 'rgba(255, 255, 255, 0.2)'; }}
          >
            {isImporting ? 'Importation en cours...' : 'Importation Technique (Base locale)'}
          </button>
        </div>

        <p style={{ textAlign: 'center', marginTop: 24, fontSize: 11, color: 'var(--text-muted)' }}>
          GEST-IN-SITU {appVersion ? `v${appVersion}` : ''} - © Ebychoco {new Date().getFullYear()} - Tous droits réservés
        </p>
      </div>

      {/* Modale de sélection de rôle */}
      {showRoleModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000
        }}>
          <div className="card animate-slide-up" style={{ maxWidth: 500, width: '100%', padding: 32, border: '1px solid rgba(255, 255, 255, 0.1)' }}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ width: 56, height: 56, borderRadius: 18, background: 'var(--gradient-button)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
                <Shield size={28} color="white" />
              </div>
              <h3 style={{ fontSize: 22, fontWeight: 800, color: 'white', margin: '0 0 8px 0' }}>
                Sélection du Rôle
              </h3>
              <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                Votre compte possède plusieurs rôles. Veuillez sélectionner celui que vous souhaitez utiliser pour cette session.
              </p>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '50vh', overflowY: 'auto', paddingRight: 4 }}>
              {availableRoles.map(role => (
                <button
                  key={role}
                  onClick={() => handleRoleSelection(role)}
                  className="role-selection-btn"
                  style={{
                    padding: '16px',
                    borderRadius: '12px',
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    color: 'white',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                    e.currentTarget.style.borderColor = 'var(--accent-primary)';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
                  }}
                >
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-primary)' }} />
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{getRoleLabel(role)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modale de confirmation d'importation */}
      {showImportModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div className="card" style={{ maxWidth: 500, width: '100%', padding: 32, textAlign: 'center', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
            <div style={{ width: 56, height: 56, borderRadius: 18, background: 'rgba(239,68,68,0.1)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
              <Shield size={28} color="#ef4444" />
            </div>
            <h3 style={{ fontSize: 20, fontWeight: 900, color: 'white', margin: '0 0 12px 0' }}>
              Importer une Base de Données ?
            </h3>
            <p style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 24 }}>
              <span style={{ color: '#ef4444', fontWeight: 700 }}>ATTENTION !</span> Cette opération va écraser la base de données locale actuelle.
              <br/><br/>
              Une sauvegarde de sécurité de la base actuelle sera automatiquement créée. Une fois l'importation terminée, l'application redémarrera pour charger les nouvelles données.
              <br/><br/>
              Voulez-vous continuer ?
            </p>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={handleImportDatabase} className="btn btn-primary" style={{ flex: 1, backgroundColor: '#ef4444', backgroundImage: 'none' }}>
                Oui, Importer
              </button>
              <button onClick={() => setShowImportModal(false)} className="btn btn-secondary" style={{ flex: 1 }}>
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


