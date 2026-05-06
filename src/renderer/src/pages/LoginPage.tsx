import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { Shield, Eye, EyeOff, Loader } from 'lucide-react';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const { login: doLogin, isLoading } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!login.trim() || !password.trim()) {
      toast.error('Veuillez remplir tous les champs');
      return;
    }
    const success = await doLogin(login.trim(), password.trim());
    if (success) {
      toast.success('Bienvenue dans GEST-IN-SITU !');
      
      // Get the user role from the store state to navigate directly
      const user = useAuthStore.getState().user;
      if (user?.role === 'CONSULTANT') {
        navigate('/consultant/recherche');
      } else if (user?.role === 'AJOUTANT') {
        navigate('/ajoutant/saisie');
      } else if (user?.role === 'EDITEUR') {
        navigate('/editeur/mission1');
      } else {
        navigate('/dashboard');
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
          <h1>GEST-IN-SITU</h1>
          <p>Système de Gestion des Cartes CMU</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
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

          <button type="submit" className="btn btn-primary" disabled={isLoading}
            style={{ width: '100%', justifyContent: 'center', padding: '12px 24px', marginTop: 8 }}>
            {isLoading ? <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> : null}
            {isLoading ? 'Connexion...' : 'Se connecter'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 24, fontSize: 11, color: 'var(--text-muted)' }}>
          GEST-IN-SITU v2.0.0 — © 2026
        </p>
      </div>
    </div>
  );
}
