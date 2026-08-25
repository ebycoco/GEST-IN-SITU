import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../stores/authStore';
import { ROLE_META } from '../../pages/RoleSelectorPage';
import { confirmService } from '../confirmService';

export default function RoleSwitcher() {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const setActiveRole = useAuthStore((s) => s.setActiveRole);

  // Click Outside logic — ref dédié à ce widget, distinct de celui de TopBar
  // (qui englobe toute la zone .topbar-right), pour ne fermer que ce menu-ci.
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const roles = user?.roles ?? (user?.role ? [user.role] : []);
  if (!user || roles.length <= 1) return null;

  const otherRoles = roles.filter((r) => r !== user.role);
  const currentMeta = ROLE_META[user.role] ?? { label: user.role, description: 'Rôle personnalisé', color: '#9ca3af', icon: '🔑' };

  const handleSwitch = async (role: string) => {
    setIsOpen(false);
    const targetMeta = ROLE_META[role] ?? { label: role, description: 'Rôle personnalisé', color: '#9ca3af', icon: '🔑' };
    const ok = await confirmService.confirm({
      title: 'Changer de rôle actif',
      message: `Vous allez basculer de "${currentMeta.label}" vers "${targetMeta.label}". Vérifiez que votre travail en cours est bien enregistré avant de continuer — vous pourrez revenir à votre rôle actuel à tout moment.`,
      confirmText: 'Changer de rôle',
      cancelText: 'Annuler',
    });
    if (!ok) return;
    try {
      await setActiveRole(role);
      toast.success(`Rôle actif : ${targetMeta.label}`);
      navigate('/', { replace: true });
    } catch (e: any) {
      toast.error(e.message || 'Impossible de changer de rôle.');
    }
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        className="topbar-icon-btn"
        title="Changer de rôle actif"
        onClick={() => setIsOpen(!isOpen)}
        style={{ color: currentMeta.color, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}
      >
        <span style={{ fontSize: 14, lineHeight: 1 }}>{currentMeta.icon}</span>
        <ChevronDown size={12} />
      </button>

      {isOpen && (
        <div className="role-switcher-dropdown">
          {otherRoles.map((role) => {
            const meta = ROLE_META[role] ?? { label: role, description: 'Rôle personnalisé', color: '#9ca3af', icon: '🔑' };
            return (
              <button
                key={role}
                className="role-switcher-item"
                onClick={() => handleSwitch(role)}
              >
                <span className="role-switcher-item-icon" style={{ background: `${meta.color}20`, border: `1px solid ${meta.color}30` }}>
                  {meta.icon}
                </span>
                <span className="role-switcher-item-label" style={{ color: meta.color }}>
                  {meta.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
