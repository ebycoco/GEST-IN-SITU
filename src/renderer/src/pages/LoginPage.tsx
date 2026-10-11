import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { Shield, Eye, EyeOff, Loader, Info } from 'lucide-react';
import toast from 'react-hot-toast';
import { confirmService } from '../components/confirmService';
import { buildWelcomeMessage, type WelcomeUser } from './loginWelcome';
import {
  normalizeNetworkState,
  shouldShowOfflineBanner,
  startBoundedPoll,
  type NetworkKind
} from './loginFirstLaunch';

// Sondage du rapatriement des comptes (premier démarrage) : le vrai téléchargement est fait par
// le SyncEngine (runSyncInitiale -> preloadUsersFromCloud), quelques secondes après le démarrage.
const FIRST_LAUNCH_POLL_INTERVAL_MS = 1500;
const FIRST_LAUNCH_POLL_TIMEOUT_MS = 60000;

export default function LoginPage() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const { login: doLogin, isLoading } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    // Les logs de diagnostique IPC ont été supprimés ici s'ils n'étaient plus nécessaires, 
    // ou remplacés par l'initialisation de l'API.
  }, []);


  const proceedToDashboard = (user: WelcomeUser | null | undefined) => {
    // Toast personnalisé (nom, sinon prénom, sinon repli) — voir loginWelcome.ts
    toast.success(buildWelcomeMessage(user));
    // Le composant RoleRedirect (route index '/') gère la redirection
    // dynamique selon le rôle. Évite les routes hardcodées incorrectes.
    navigate('/');
  };


  const [showImportModal, setShowImportModal] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  // Mot de passe SUPER ADMIN requis par le handler IPC 'database:import' (fail-closed).
  // Conservé en mémoire uniquement le temps de la modale, jamais persisté.
  const [importPassword, setImportPassword] = useState('');
  const [showImportPwd, setShowImportPwd] = useState(false);

  const handleImportDatabase = async () => {
    setShowImportModal(false);
    setIsImporting(true);
    const toastId = toast.loading("Préparation de l'importation...");
    try {
      const res = await window.api.database.import(undefined, importPassword);
      if (res.success) {
        toast.success("Base de données importée avec succès ! Redémarrage...", { id: toastId });
      } else if (res.reason === 'cancelled') {
        toast.error("Importation annulée par l'utilisateur.", { id: toastId });
      } else if (res.reason === 'invalid_extension') {
        toast.error("Extension de fichier invalide. Requis: .db ou .sqlite", { id: toastId });
      } else if (res.reason === 'invalid_sqlite_header') {
        toast.error("Format de fichier SQLite invalide.", { id: toastId });
      } else if (res.reason === 'unauthorized') {
        toast.error("Mot de passe SUPER ADMIN incorrect.", { id: toastId });
      } else if (res.reason === 'invalid_database') {
        toast.error("Base refusée : fichier non valide, incompatible ou en échec d'intégrité. Aucune donnée n'a été modifiée.", { id: toastId, duration: 8000 });
      } else {
        toast.error(`Échec de l'importation : ${res.reason}`, { id: toastId });
      }
    } catch (err: any) {
      toast.error(`Erreur : ${err.message || err}`, { id: toastId });
    } finally {
      // Le mot de passe SUPER ADMIN ne doit jamais rester en mémoire au-delà de la tentative.
      setImportPassword('');
      setIsImporting(false);
    }
  };

  // États pour la première installation et la sécurité réseau
  const [isFirstLaunch, setIsFirstLaunch] = useState(false);
  const [isOnline, setIsOnline] = useState(window.navigator.onLine);
  const [setupStatus, setSetupStatus] = useState<'idle' | 'pulling' | 'success' | 'failed'>('idle');
  const [setupMessage, setSetupMessage] = useState('');
  // Dernier verdict réseau du main (null tant qu'aucun événement reçu) — sert à distinguer un
  // vrai hors-ligne d'un échec de configuration alors que le réseau est en ligne.
  const [mainNetworkKind, setMainNetworkKind] = useState<NetworkKind | null>(null);

  // Annulation du sondage en cours + identifiant de la tentative courante : toute nouvelle
  // tentative (ou le démontage) invalide la précédente, donc aucun sondage cumulé ni timer orphelin.
  const cancelPollRef = useRef<(() => void) | null>(null);
  const setupRunIdRef = useRef(0);
  const setupPullingRef = useRef(false);

  // Nettoyage au démontage uniquement (l'effet réseau ci-dessous se ré-exécute à chaque
  // changement d'état et ne doit pas interrompre un sondage en cours).
  useEffect(() => {
    return () => {
      setupRunIdRef.current += 1;
      setupPullingRef.current = false;
      if (cancelPollRef.current) {
        cancelPollRef.current();
        cancelPollRef.current = null;
      }
    };
  }, []);

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
        // Le main émet les états en MAJUSCULES (ONLINE/OFFLINE/PROBING/DEGRADED/PERMANENT_OFFLINE).
        // DEGRADED compte comme en ligne ; PROBING (transitoire) ne modifie pas l'affichage.
        const kind = normalizeNetworkState(status?.state);
        if (kind === 'unknown') return;
        setMainNetworkKind(kind);
        const netState = kind === 'online';
        setIsOnline(netState);
        if (netState && isFirstLaunch && setupStatus !== 'success' && setupStatus !== 'pulling' && !setupPullingRef.current) {
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
  /**
   * Configuration du premier démarrage.
   *
   * Flux asynchrone : forcePing -> forceGlobal -> sondage borné de checkFirstLaunch.
   * forceGlobal ne télécharge rien sur base vide : le rapatriement réel des comptes est fait par
   * le SyncEngine (runSyncInitiale -> preloadUsersFromCloud). On reste donc en 'pulling' et on
   * sonde toutes les 1,5 s (setTimeout enchaînés, 60 s max) jusqu'à ce que t_users soit rempli.
   *
   * Annulation/anti-cumul : chaque appel invalide le précédent (setupRunIdRef) et annule son
   * sondage ; le démontage fait de même (effet dédié). Aucun listener IPC n'est ajouté ici.
   */
  const triggerFirstLaunchSetup = async () => {
    if (cancelPollRef.current) {
      cancelPollRef.current();
      cancelPollRef.current = null;
    }
    setupRunIdRef.current += 1;
    const runId = setupRunIdRef.current;
    const isStale = () => runId !== setupRunIdRef.current;

    setupPullingRef.current = true;
    setSetupStatus('pulling');
    setSetupMessage("🟡 Connexion en cours... (Vérification du réseau Supabase)");
    const fail = (message: string) => {
      setupPullingRef.current = false;
      setSetupStatus('failed');
      setSetupMessage(message);
    };
    try {
      const pingRes = await window.api.sync.forcePing();
      if (isStale()) return;
      if (!pingRes || !pingRes.success || pingRes.state === 'OFFLINE') {
        fail("🔴 Échec de la configuration — Le réseau Supabase est actuellement injoignable.");
        return;
      }

      setSetupMessage("🟡 Connexion établie — Téléchargement et configuration de la base de données...");
      // Pull global de la synchronisation de démarrage (site + centres + agents)
      const syncRes = await window.api.sync.forceGlobal();
      if (isStale()) return;
      if (!syncRes || !syncRes.success) {
        fail("🔴 Échec de la configuration — Impossible de contacter le cloud Supabase.");
        return;
      }

      const isConfigured = async (): Promise<boolean> => {
        const check = await window.api.app.checkFirstLaunch();
        return !!check && !check.isFirstLaunch;
      };
      const onConfigured = () => {
        setupPullingRef.current = false;
        setSetupStatus('success');
        setSetupMessage("🟢 Configuration réussie — Vous pouvez maintenant vous connecter.");
        toast.success("Configuration initiale terminée !");
      };

      // Les comptes sont peut-être déjà arrivés : un contrôle immédiat évite d'attendre 1,5 s.
      if (await isConfigured()) {
        if (isStale()) return;
        onConfigured();
        return;
      }
      if (isStale()) return;

      setSetupMessage("🟡 Connexion établie — Rapatriement des comptes agents en cours...");
      cancelPollRef.current = startBoundedPoll({
        check: isConfigured,
        intervalMs: FIRST_LAUNCH_POLL_INTERVAL_MS,
        timeoutMs: FIRST_LAUNCH_POLL_TIMEOUT_MS,
        onDone: (outcome) => {
          cancelPollRef.current = null;
          if (isStale()) return;
          if (outcome === 'success') {
            onConfigured();
          } else {
            fail("🔴 Échec de la configuration — Aucun compte agent récupéré depuis Supabase.");
          }
        }
      });
    } catch (err: any) {
      console.error(err);
      if (isStale()) return;
      fail("🔴 Échec de la configuration — Une erreur réseau est survenue lors de la configuration.");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!login.trim() || !password.trim()) {
      toast.error('Veuillez remplir tous les champs');
      return;
    }
    
    try {
      const success = await doLogin(login.trim(), password.trim());
      if (success) {
        const user = useAuthStore.getState().user;
        // Log diagnostic de connexion (multi-rôle ou mono-rôle)
        const roles = user?.roles ?? (user?.role ? [user.role] : []);
        console.info(`[LOGIN] Connexion réussie. Login: ${user?.login} | Rôles disponibles: ${roles.join(', ')}`);

        if (roles.length > 1) {
          // Multi-rôle → page dédiée de sélection
          toast.success(buildWelcomeMessage(user, { multiRole: true }));
          navigate('/role-selector');
        } else {
          proceedToDashboard(user);
        }
      } else {
        await confirmService.confirm({
          title: 'Connexion échouée',
          message: 'Identifiant ou mot de passe incorrect',
          isAlert: true,
          isDanger: true
        });
        setPassword('');
      }
    } catch (error: any) {
      // authStore.login() repropage explicitement les erreurs levées par authenticateUser()
      // (cf. handler IPC auth:login) — distinguer les causes licence/site des autres erreurs
      // pour éviter le message trompeur "Identifiants incorrects" quand le mot de passe est
      // pourtant correct.
      // ipcRenderer.invoke enveloppe l'erreur du Main Process : error.message vaut en réalité
      // "Error invoking remote method 'auth:login': Error: LICENCE_EXPIREE" — .includes() (et non
      // ===) est donc requis pour détecter correctement ce cas.
      if (error?.message?.includes('LICENCE_EXPIREE')) {
        await confirmService.confirm({
          title: 'Licence expirée',
          message: 'La licence de votre site a expiré. Veuillez contacter le super administrateur.',
          isAlert: true,
          isDanger: true
        });
      } else if (error?.message?.includes('SITE_SUSPENDU')) {
        await confirmService.confirm({
          title: 'Accès suspendu',
          message: "L'accès de votre site a été suspendu. Veuillez contacter le Super Administrateur.",
          isAlert: true,
          isDanger: true
        });
      } else {
        toast.error("Erreur de connexion. Veuillez réessayer.");
      }
    }
  };

  // « Hors-ligne » réel conservé ; en échec de configuration réseau OK, le message de config prime.
  const showOfflineBanner = shouldShowOfflineBanner({
    isOnline,
    setupStatus,
    navigatorOnLine: window.navigator.onLine,
    mainNetworkKind
  });

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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
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
                ...(showOfflineBanner ? {
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
              {showOfflineBanner ? (
                "🔴 Hors-ligne — Une connexion Internet est requise pour la première configuration de l'application."
              ) : (
                setupMessage || "🟡 Connexion établie — Préparation de la base de données..."
              )}
            </div>
          )}
          {/* ───────────────────────────────────────────── */}

        {isFirstLaunch && setupStatus !== 'success' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20, marginTop: 20, alignItems: 'center' }}>
            {setupStatus === 'pulling' || setupStatus === 'idle' ? (
              <>
                <Loader size={32} style={{ animation: 'spin 1s linear infinite', color: 'var(--accent-primary)' }} />
                <p style={{ color: 'var(--text-secondary)', textAlign: 'center', fontSize: 14 }}>
                  Premier démarrage : Rapatriement des comptes...
                </p>
              </>
            ) : null}
            {setupStatus === 'failed' && (
              <button 
                type="button" 
                className="btn btn-secondary" 
                onClick={triggerFirstLaunchSetup}
                style={{ marginTop: 8 }}
              >
                Réessayer la connexion
              </button>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="form-group">
              <label className="form-label">Identifiant</label>
              <input className="form-input" type="text" placeholder="Entrez votre identifiant"
                value={login} onChange={(e) => setLogin(e.target.value)} autoFocus
                data-testid="login-input" />
            </div>

            <div className="form-group">
              <label className="form-label">Mot de passe</label>
              <div style={{ position: 'relative' }}>
                <input className="form-input" type={showPwd ? 'text' : 'password'}
                  placeholder="Entrez votre mot de passe" style={{ width: '100%', paddingRight: 44 }}
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  data-testid="password-input" />
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
              disabled={isLoading}
              style={{ width: '100%', justifyContent: 'center', padding: '12px 24px', marginTop: 8 }}
              data-testid="login-submit"
            >
              {isLoading ? <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> : null}
              {isLoading ? 'Connexion...' : 'Se connecter'}
            </button>
          </form>
        )}
        </div>

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
            <div className="form-group" style={{ textAlign: 'left', marginBottom: 24 }}>
              <label className="form-label">Mot de passe SUPER ADMIN</label>
              <div style={{ position: 'relative' }}>
                <input className="form-input" type={showImportPwd ? 'text' : 'password'}
                  placeholder="Entrez le mot de passe SUPER ADMIN" style={{ width: '100%', paddingRight: 44 }}
                  value={importPassword} onChange={(e) => setImportPassword(e.target.value)}
                  data-testid="import-password-input" />
                <button type="button" onClick={() => setShowImportPwd(!showImportPwd)}
                  style={{
                    position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)'
                  }}>
                  {showImportPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={handleImportDatabase} className="btn btn-primary" disabled={!importPassword} style={{ flex: 1, backgroundColor: '#ef4444', backgroundImage: 'none' }}>
                Oui, Importer
              </button>
              <button onClick={() => { setShowImportModal(false); setImportPassword(''); }} className="btn btn-secondary" style={{ flex: 1 }}>
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


