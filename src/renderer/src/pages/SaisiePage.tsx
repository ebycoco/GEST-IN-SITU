import React, { useRef, useState } from 'react';
import {
  UserPlus,
  Save,
  RotateCcw,
  User,
  Hash,
  Phone,
  MapPin,
  Archive,
  Building2,
  Layers,
  Briefcase,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import toast from 'react-hot-toast';
import DateInput from '../components/DateInput';
import CentreContextSwitcher from '../components/layout/CentreContextSwitcher';
import { useAuthStore } from '../stores/authStore';

// ─── Types ────────────────────────────────────────────────────────────────────
interface FormState {
  noms: string;
  prenoms: string;
  date_de_naissance: string;
  lieu_de_naissance: string;
  contact: string;
  num_secu: string;
  rangement: string;
  site: string;
  centre: string;
  poste: string;
}

const INITIAL_STATE: FormState = {
  noms: '',
  prenoms: '',
  date_de_naissance: '',
  lieu_de_naissance: '',
  contact: '',
  num_secu: '',
  rangement: '',
  site: '',
  centre: '',
  poste: '',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  required?: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
  hint?: string;
}

function FormField({ label, required, icon, children, hint }: FieldProps) {
  return (
    <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label
        className="form-label"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.05em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}
      >
        <span style={{ opacity: 0.7 }}>{icon}</span>
        {label}
        {required && <span style={{ color: '#f97316', marginLeft: 2 }}>*</span>}
      </label>
      {children}
      {hint && (
        <span style={{ fontSize: 11, color: 'var(--text-muted)', opacity: 0.7 }}>{hint}</span>
      )}
    </div>
  );
}

interface InputWithIconProps {
  icon: React.ReactNode;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  tabIndex?: number;
  autoFocus?: boolean;
  required?: boolean;
  style?: React.CSSProperties;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}

function InputWithIcon({
  icon,
  value,
  onChange,
  placeholder,
  tabIndex,
  autoFocus,
  required,
  style,
  inputMode,
}: InputWithIconProps) {
  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <span
        style={{
          position: 'absolute',
          left: 14,
          color: 'var(--text-muted)',
          opacity: 0.55,
          display: 'flex',
          alignItems: 'center',
          pointerEvents: 'none',
          zIndex: 1,
        }}
      >
        {icon}
      </span>
      <input
        type="text"
        className="form-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        tabIndex={tabIndex}
        autoFocus={autoFocus}
        required={required}
        inputMode={inputMode}
        style={{ paddingLeft: 42, width: '100%', ...style }}
      />
    </div>
  );
}

// ─── Section Separator ────────────────────────────────────────────────────────
interface SectionProps {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  accentColor?: string;
}

function SectionHeader({ icon, title, subtitle, accentColor = 'var(--accent-primary)' }: SectionProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 0',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        marginBottom: 4,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: `linear-gradient(135deg, ${accentColor}33, ${accentColor}18)`,
          border: `1px solid ${accentColor}44`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: accentColor,
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</div>
        {subtitle && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{subtitle}</div>
        )}
      </div>
      <div
        style={{
          flex: 1,
          height: 1,
          background: `linear-gradient(90deg, ${accentColor}30, transparent)`,
          marginLeft: 8,
        }}
      />
    </div>
  );
}

// ─── Grid helper ──────────────────────────────────────────────────────────────
const GRID2: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: '1.2rem',
};
const GRID3: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: '1.2rem',
};

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function SaisiePage() {
  const { user, activeSiteId, selectedCentreId } = useAuthStore();
  const [formData, setFormData] = useState<FormState>(INITIAL_STATE);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const firstInputRef = useRef<HTMLDivElement>(null);

  const [sites, setSites] = useState<any[]>([]);
  const [centres, setCentres] = useState<any[]>([]);

  // Charger les référentiels de sites et centres
  React.useEffect(() => {
    window.api.hierarchy.getSites().then(setSites).catch(console.error);
    window.api.hierarchy.getCentres().then(setCentres).catch(console.error);
  }, []);

  const activeSiteName = sites.find(s => s.id === (user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id))?.nom || '';
  const activeCentreName = centres.find(c => c.id === selectedCentreId)?.nom || '';

  const updateUpper = (field: keyof FormState) => (value: string) =>
    setFormData((prev) => ({ ...prev, [field]: value.toUpperCase() }));

  const updateRaw = (field: keyof FormState) => (value: string) =>
    setFormData((prev) => ({ ...prev, [field]: value }));

  const handleReset = () => {
    if (confirm('Voulez-vous vraiment vider le formulaire ?')) {
      setFormData({
        ...INITIAL_STATE,
        site: activeSiteName,
        centre: activeCentreName,
      });
      setSaved(false);
      setTimeout(() => {
        (firstInputRef.current?.querySelector('input') as HTMLInputElement | null)?.focus();
      }, 50);
    }
  };

  // Synchronise les valeurs site/centre au montage ou au changement de site/centre actif
  React.useEffect(() => {
    setFormData(prev => ({
      ...prev,
      site: activeSiteName,
      centre: activeCentreName
    }));
  }, [activeSiteName, activeCentreName]);

  // Formatage de téléphone dynamique style Ivoirien (+225 XX XX XX XX XX)
  const formatPhoneNumber = (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length === 0) return '';
    let localNum = digits;
    if (digits.startsWith('225') && digits.length > 3) {
      localNum = digits.substring(3);
    }
    const truncated = localNum.substring(0, 10);
    let formatted = '+225';
    for (let i = 0; i < truncated.length; i++) {
      if (i % 2 === 0) {
        formatted += ' ';
      }
      formatted += truncated[i];
    }
    return formatted;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.noms.trim() || !formData.prenoms.trim() || !formData.lieu_de_naissance.trim()) {
      toast.error('Les champs Nom de famille, Prénom(s) et Lieu de naissance sont obligatoires.');
      return;
    }
    if (formData.date_de_naissance.length !== 10) {
      toast.error('La date de naissance est invalide ou incomplète.');
      return;
    }
    if (!formData.num_secu.trim() || formData.num_secu.trim().length !== 13) {
      toast.error('Le N° de Sécurité Sociale (CMU) est obligatoire et doit faire exactement 13 chiffres.');
      return;
    }
    if (user?.role === 'ADMINISTRATEUR_SITE' && !selectedCentreId) {
      toast.error('Veuillez sélectionner un centre de travail en haut de la page.');
      return;
    }

    const siteIdToUse = user?.role === 'SUPER ADMIN' ? activeSiteId : user?.site_id;
    if (!siteIdToUse) {
      toast.error('Aucun site sélectionné.');
      return;
    }

    setIsSaving(true);
    setSaved(false);
    try {
      await window.api.cartes.create({
        ...formData,
        site: activeSiteName,
        centre: activeCentreName,
        site_id: siteIdToUse,
        agent_saisie: `${user?.nom_user || ''} ${user?.prenom_user || ''}`.trim() || user?.login || 'OPERATEUR_SAISIE',
        created_by: user?.id_user || null,
        centre_id: selectedCentreId,
        statut: 'EN STOCK',
        statut_physique: 'OK',
      });
      toast.success('✅ Carte enregistrée avec succès !');
      setSaved(true);
      setFormData({
        ...INITIAL_STATE,
        site: activeSiteName,
        centre: activeCentreName,
      });
      setTimeout(() => {
        (firstInputRef.current?.querySelector('input') as HTMLInputElement | null)?.focus();
      }, 100);
    } catch (err) {
      console.error(err);
      toast.error("Erreur lors de l'enregistrement.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="animate-fade-in"
      style={{ padding: '24px 28px', maxWidth: 960, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}
    >
      <CentreContextSwitcher />

      {/* ── Page Header ──────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '20px 24px',
          background: 'linear-gradient(135deg, rgba(139,92,246,0.12) 0%, rgba(59,130,246,0.06) 100%)',
          border: '1px solid rgba(139,92,246,0.2)',
          borderRadius: 16,
          backdropFilter: 'blur(8px)',
        }}
      >
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 14,
            background: 'linear-gradient(135deg, #8b5cf6, #3b82f6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            boxShadow: '0 4px 20px rgba(139,92,246,0.4)',
            flexShrink: 0,
          }}
        >
          <UserPlus size={26} />
        </div>
        <div style={{ flex: 1 }}>
          <h2
            style={{
              margin: 0,
              fontSize: 20,
              fontWeight: 800,
              background: 'linear-gradient(135deg, #c4b5fd, #93c5fd)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Nouvelle Saisie de Carte CMU
          </h2>
          <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>
            Enregistrement manuel · Champs marqués{' '}
            <strong style={{ color: '#f97316' }}>*</strong> obligatoires
          </p>
        </div>
        {saved && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              background: 'rgba(34,197,94,0.15)',
              border: '1px solid rgba(34,197,94,0.3)',
              borderRadius: 10,
              color: '#4ade80',
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <CheckCircle2 size={16} />
            Enregistrée !
          </div>
        )}
      </div>

      {/* ── Form Card ────────────────────────────────────────────────────────── */}
      <form
        onSubmit={handleSave}
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 20,
          padding: '28px 32px',
          backdropFilter: 'blur(12px)',
          display: 'flex',
          flexDirection: 'column',
          gap: 28,
          boxShadow: '0 8px 40px rgba(0,0,0,0.25)',
        }}
      >
        {/* ── SECTION 1 : Identité ─────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <SectionHeader
            icon={<User size={18} />}
            title="Identité de l'assuré"
            subtitle="Informations civiles principales"
            accentColor="#8b5cf6"
          />

          <div style={GRID2}>
            <div ref={firstInputRef}>
              <FormField label="Nom de famille" required icon={<User size={14} />}>
                <InputWithIcon
                  icon={<User size={16} />}
                  value={formData.noms}
                  onChange={updateUpper('noms')}
                  placeholder="Ex: KOUASSI"
                  tabIndex={1}
                  autoFocus
                  required
                  style={{ textTransform: 'uppercase' }}
                />
              </FormField>
            </div>
            <FormField label="Prénom(s)" required icon={<User size={14} />}>
              <InputWithIcon
                icon={<User size={16} />}
                value={formData.prenoms}
                onChange={updateUpper('prenoms')}
                placeholder="Ex: JEAN BAPTISTE"
                tabIndex={2}
                required
                style={{ textTransform: 'uppercase' }}
              />
            </FormField>
          </div>

          <div style={GRID2}>
            <DateInput
              label={
                <>
                  Date de naissance <span style={{ color: '#f97316', marginLeft: 2 }}>*</span>
                </>
              }
              value={formData.date_de_naissance}
              onChange={updateRaw('date_de_naissance')}
              required
            />
            <FormField label="Lieu de naissance" required icon={<MapPin size={14} />}>
              <InputWithIcon
                icon={<MapPin size={16} />}
                value={formData.lieu_de_naissance}
                onChange={updateUpper('lieu_de_naissance')}
                placeholder="Ex: ABIDJAN"
                tabIndex={4}
                required
                style={{ textTransform: 'uppercase' }}
              />
            </FormField>
          </div>

          <div style={GRID2}>
            <FormField
              label="N° Sécurité Sociale (CMU)"
              required
              icon={<Hash size={14} />}
              hint="Saisie obligatoire (Exactement 13 chiffres)"
            >
              <InputWithIcon
                icon={<Hash size={16} />}
                value={formData.num_secu}
                onChange={(v) => updateUpper('num_secu')(v.replace(/\D/g, '').substring(0, 13))}
                placeholder="Ex: 3841236548952"
                tabIndex={5}
                inputMode="numeric"
                required
              />
            </FormField>
            <FormField
              label="Contact / Téléphone"
              icon={<Phone size={14} />}
              hint="Format : +225 XX XX XX XX XX"
            >
              <InputWithIcon
                icon={<Phone size={16} />}
                value={formData.contact}
                onChange={(v) => updateRaw('contact')(formatPhoneNumber(v))}
                placeholder="Ex: +225 07 00 00 00 00"
                tabIndex={6}
                inputMode="tel"
              />
            </FormField>
          </div>
        </div>

        {/* ── SECTION 2 : Localisation & Rangement ─────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <SectionHeader
            icon={<Briefcase size={18} />}
            title="Localisation &amp; Rangement"
            subtitle="Emplacement physique de la carte dans le stock"
            accentColor="#3b82f6"
          />

          <div style={GRID3}>
            <FormField label="Site" required icon={<Building2 size={14} />}>
              <InputWithIcon
                icon={<Building2 size={16} />}
                value={formData.site}
                onChange={() => {}}
                placeholder="Site de rattachement"
                tabIndex={7}
                style={{ opacity: 0.75, background: 'rgba(255,255,255,0.02)', cursor: 'not-allowed' }}
                required
              />
            </FormField>
            <FormField label="Centre" required icon={<Layers size={14} />}>
              <InputWithIcon
                icon={<Layers size={16} />}
                value={formData.centre}
                onChange={() => {}}
                placeholder="Centre de travail"
                tabIndex={8}
                style={{ opacity: 0.75, background: 'rgba(255,255,255,0.02)', cursor: 'not-allowed' }}
                required
              />
            </FormField>
            <FormField label="Lieu d'enrôlement" icon={<MapPin size={14} />}>
              <InputWithIcon
                icon={<MapPin size={16} />}
                value={formData.poste}
                onChange={updateUpper('poste')}
                placeholder="Ex: MAIRIE ABOBO"
                tabIndex={9}
              />
            </FormField>
          </div>

          {/* Code Rangement — pleine largeur, mis en avant */}
          <FormField
            label="Code Rangement"
            icon={<Archive size={14} />}
            hint="Code de la boîte ou du casier de stockage physique (Optionnel)"
          >
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <span
                style={{
                  position: 'absolute',
                  left: 14,
                  color: '#3b82f6',
                  opacity: 0.7,
                  display: 'flex',
                  alignItems: 'center',
                  pointerEvents: 'none',
                  zIndex: 1,
                }}
              >
                <Archive size={18} />
              </span>
              <input
                type="text"
                className="form-input"
                value={formData.rangement}
                onChange={(e) => updateUpper('rangement')(e.target.value)}
                placeholder="Ex: BOITE 42 / RAYON C"
                tabIndex={10}
                style={{
                  paddingLeft: 42,
                  width: '100%',
                  fontWeight: 700,
                  fontSize: 16,
                  letterSpacing: '0.08em',
                  background: 'rgba(59,130,246,0.06)',
                  border: '1px solid rgba(59,130,246,0.2)',
                }}
              />
            </div>
          </FormField>
        </div>

        {/* ── Info Banner ──────────────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 16px',
            background: 'rgba(250,204,21,0.06)',
            border: '1px solid rgba(250,204,21,0.18)',
            borderRadius: 10,
            fontSize: 12,
            color: 'var(--text-muted)',
          }}
        >
          <Sparkles size={14} style={{ color: '#facc15', flexShrink: 0 }} />
          <span>
            La carte sera enregistrée avec le statut&nbsp;
            <strong style={{ color: '#facc15' }}>EN STOCK</strong> et affectée à l&apos;agent&nbsp;
            <strong style={{ color: 'var(--text-primary)' }}>{user?.nom_user || user?.login || '—'}</strong>.
            Le formulaire se réinitialise automatiquement après chaque enregistrement.
          </span>
        </div>

        {/* ── Actions ──────────────────────────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            paddingTop: 8,
            borderTop: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleReset}
            disabled={isSaving}
            tabIndex={11}
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <RotateCcw size={15} />
            Réinitialiser
          </button>

          <button
            type="submit"
            disabled={isSaving}
            tabIndex={12}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '13px 32px',
              background: isSaving
                ? 'rgba(139,92,246,0.4)'
                : 'linear-gradient(135deg, #8b5cf6, #3b82f6)',
              color: 'white',
              border: 'none',
              borderRadius: 12,
              fontWeight: 700,
              fontSize: 15,
              cursor: isSaving ? 'not-allowed' : 'pointer',
              boxShadow: isSaving ? 'none' : '0 4px 20px rgba(139,92,246,0.4)',
              transition: 'all 0.2s ease',
              letterSpacing: '0.02em',
            }}
          >
            {isSaving ? (
              <>
                <span
                  style={{
                    width: 16,
                    height: 16,
                    border: '2px solid rgba(255,255,255,0.3)',
                    borderTopColor: 'white',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                    display: 'inline-block',
                  }}
                />
                Enregistrement…
              </>
            ) : (
              <>
                <Save size={18} />
                Enregistrer la carte
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

