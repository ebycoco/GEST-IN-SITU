import React, { useState } from 'react';
import { RefreshCw, Save, Edit3, Phone, MapPin, ShieldAlert, Fingerprint, AlertCircle } from 'lucide-react';
import DateInput from '../DateInput';

export interface IAnomalyRecord {
  id_carte?: number;
  id?: number;
  noms?: string;
  prenoms?: string;
  date_de_naissance?: string;
  contact?: string;
  lieu_de_naissance?: string;
  num_secu?: string;
  [key: string]: any;
}

interface ExpandedAnomalyDetailsProps {
  record: IAnomalyRecord;
  isResolving: boolean;
  onSaveField: (field: string, value: string) => Promise<boolean>;
  colorTheme?: string;
  onForceStock?: () => void;
  isDeleting?: boolean;
}

export function ExpandedAnomalyDetails({ record, isResolving, onSaveField, colorTheme = '#ff6348', onForceStock, isDeleting = false }: ExpandedAnomalyDetailsProps) {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const startEdit = (field: string, value: string) => {
    setEditingField(field);
    setEditValue(value || '');
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValue('');
  };

  const handleSave = async (field: string) => {
    // Correctif P1b : onSaveField renvoie désormais un booléen de succès (le parent
    // peut échouer silencieusement côté validation/serveur en se contentant d'un
    // toast.error, sans lever d'exception). On ne referme l'édition que si la
    // sauvegarde a réellement réussi, pour ne jamais faire perdre la saisie en cours
    // de l'agent quand une validation échoue (ex. num_secu à 12 chiffres).
    const success = await onSaveField(field, editValue);
    if (success) {
      setEditingField(null);
    }
  };

  return (
    <div className="animate-fade-in" style={{ padding: '20px 20px 20px 50px', background: 'rgba(0,0,0,0.15)', overflow: 'hidden', borderLeft: `3px solid ${colorTheme}` }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
        
        {/* NOMS */}
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
            <ShieldAlert size={11} /> Noms
          </div>
          {editingField === 'noms' ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Nom..."
                style={{ width: 140, height: 32, background: '#0a0e1a', color: 'white', border: '1px solid var(--border-color)', fontSize: 13 }}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value.toUpperCase())}
                autoFocus
              />
              <button className="btn btn-primary" style={{ padding: '4px 10px' }} onClick={() => handleSave('noms')} disabled={isResolving}>
                {isResolving ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
              </button>
              <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={cancelEdit}>✕</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 14 }}>
              <span>{record.noms || <span style={{ color: '#ff7675', fontSize: 13 }}>Donnée manquante</span>}</span>
              <button
                className="btn btn-secondary"
                style={{ padding: '2px 8px', fontSize: 11, border: '1px solid rgba(236,72,153,0.4)', color: '#ec4899', background: 'rgba(236,72,153,0.08)' }}
                onClick={(e) => { e.stopPropagation(); startEdit('noms', record.noms || ''); }}
              >
                <Edit3 size={10} style={{ marginRight: 3 }} />Modifier
              </button>
            </div>
          )}
        </div>

        {/* PRENOMS */}
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
            <ShieldAlert size={11} /> Prénoms
          </div>
          {editingField === 'prenoms' ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Prénoms..."
                style={{ width: 140, height: 32, background: '#0a0e1a', color: 'white', border: '1px solid var(--border-color)', fontSize: 13 }}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value.toUpperCase())}
                autoFocus
              />
              <button className="btn btn-primary" style={{ padding: '4px 10px' }} onClick={() => handleSave('prenoms')} disabled={isResolving}>
                {isResolving ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
              </button>
              <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={cancelEdit}>✕</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 14 }}>
              <span>{record.prenoms || <span style={{ color: '#ff7675', fontSize: 13 }}>Donnée manquante</span>}</span>
              <button
                className="btn btn-secondary"
                style={{ padding: '2px 8px', fontSize: 11, border: '1px solid rgba(20,184,166,0.4)', color: '#14b8a6', background: 'rgba(20,184,166,0.08)' }}
                onClick={(e) => { e.stopPropagation(); startEdit('prenoms', record.prenoms || ''); }}
              >
                <Edit3 size={10} style={{ marginRight: 3 }} />Modifier
              </button>
            </div>
          )}
        </div>

        {/* DATE DE NAISSANCE */}
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Date de naissance</div>
          {editingField === 'date_de_naissance' ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <div style={{ width: 140 }}>
                <DateInput value={editValue} onChange={setEditValue} autoFocus disabled={isResolving} />
              </div>
              <button className="btn btn-primary" style={{ padding: '4px 10px' }} onClick={() => handleSave('date_de_naissance')} disabled={isResolving}>
                {isResolving ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
              </button>
              <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={cancelEdit}>✕</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 14 }}>
              <span>{record.date_de_naissance || <span style={{ color: '#ff7675', fontSize: 13 }}>Donnée manquante</span>}</span>
              <button
                className="btn btn-secondary"
                style={{ padding: '2px 8px', fontSize: 11, border: '1px solid rgba(167,139,250,0.4)', color: '#a78bfa', background: 'rgba(167,139,250,0.08)' }}
                onClick={(e) => { e.stopPropagation(); startEdit('date_de_naissance', record.date_de_naissance || ''); }}
              >
                <Edit3 size={10} style={{ marginRight: 3 }} />Modifier
              </button>
            </div>
          )}
        </div>

        {/* CONTACT */}
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Phone size={11} /> Contact
          </div>
          {editingField === 'contact' ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Ex: 0708090010"
                maxLength={10}
                inputMode="numeric"
                style={{ width: 140, height: 32, background: '#0a0e1a', color: 'white', border: '1px solid var(--border-color)', fontSize: 13 }}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value.replace(/\D/g, '').slice(0, 10))}
                autoFocus
              />
              <button className="btn btn-primary" style={{ padding: '4px 10px' }} onClick={() => handleSave('contact')} disabled={isResolving}>
                {isResolving ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
              </button>
              <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={cancelEdit}>✕</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 14 }}>
              <span>{record.contact || <span style={{ color: '#ff7675', fontSize: 13 }}>Donnée manquante</span>}</span>
              <button
                className="btn btn-secondary"
                style={{ padding: '2px 8px', fontSize: 11, border: '1px solid rgba(245,158,11,0.4)', color: '#f59e0b', background: 'rgba(245,158,11,0.08)' }}
                onClick={(e) => { e.stopPropagation(); startEdit('contact', record.contact?.replace(/\D/g, '') || ''); }}
              >
                <Edit3 size={10} style={{ marginRight: 3 }} />Modifier
              </button>
            </div>
          )}
        </div>

        {/* LIEU DE NAISSANCE */}
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
            <MapPin size={11} /> Lieu de naissance
          </div>
          {editingField === 'lieu_de_naissance' ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Lieu..."
                style={{ width: 140, height: 32, background: '#0a0e1a', color: 'white', border: '1px solid var(--border-color)', fontSize: 13 }}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value.toUpperCase())}
                autoFocus
              />
              <button className="btn btn-primary" style={{ padding: '4px 10px' }} onClick={() => handleSave('lieu_de_naissance')} disabled={isResolving}>
                {isResolving ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
              </button>
              <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={cancelEdit}>✕</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 14 }}>
              <span>{record.lieu_de_naissance || <span style={{ color: '#ff7675', fontSize: 13 }}>Donnée manquante</span>}</span>
              <button
                className="btn btn-secondary"
                style={{ padding: '2px 8px', fontSize: 11, border: '1px solid rgba(46,213,115,0.4)', color: '#2ed573', background: 'rgba(46,213,115,0.08)' }}
                onClick={(e) => { e.stopPropagation(); startEdit('lieu_de_naissance', record.lieu_de_naissance || ''); }}
              >
                <Edit3 size={10} style={{ marginRight: 3 }} />Modifier
              </button>
            </div>
          )}
        </div>

        {/* NUMERO DE SECURITE SOCIALE */}
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Fingerprint size={11} /> Numéro de Sécurité Sociale
          </div>
          {editingField === 'num_secu' ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="text"
                className="form-input"
                placeholder="N° Sécu (13 chiffres)"
                maxLength={13}
                inputMode="numeric"
                style={{ width: 160, height: 32, background: '#0a0e1a', color: 'white', border: '1px solid var(--border-color)', fontSize: 13 }}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value.replace(/\D/g, '').slice(0, 13))}
                autoFocus
              />
              <button className="btn btn-primary" style={{ padding: '4px 10px' }} onClick={() => handleSave('num_secu')} disabled={isResolving}>
                {isResolving ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
              </button>
              <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={cancelEdit}>✕</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 14 }}>
              <span>{record.num_secu || <span style={{ color: '#ff7675', fontSize: 13 }}>Donnée manquante</span>}</span>
              <button
                className="btn btn-secondary"
                style={{ padding: '2px 8px', fontSize: 11, border: '1px solid rgba(112,161,255,0.4)', color: '#70a1ff', background: 'rgba(112,161,255,0.08)' }}
                onClick={(e) => { e.stopPropagation(); startEdit('num_secu', record.num_secu?.replace(/\D/g, '') || ''); }}
              >
                <Edit3 size={10} style={{ marginRight: 3 }} />Modifier
              </button>
            </div>
          )}
        </div>

        {/* RANGEMENT */}
        <div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
            <MapPin size={11} /> Emplacement (Rangement)
          </div>
          {editingField === 'rangement' ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Ex: KM102"
                style={{ width: 140, height: 32, background: '#0a0e1a', color: 'white', border: '1px solid var(--border-color)', fontSize: 13 }}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                autoFocus
              />
              <button className="btn btn-primary" style={{ padding: '4px 10px' }} onClick={() => handleSave('rangement')} disabled={isResolving}>
                {isResolving ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
              </button>
              <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={cancelEdit}>✕</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 14 }}>
              <span>{record.rangement || <span style={{ color: '#ff7675', fontSize: 13 }}>Donnée manquante</span>}</span>
              <button
                className="btn btn-secondary"
                style={{ padding: '2px 8px', fontSize: 11, border: '1px solid rgba(46,213,115,0.4)', color: '#2ed573', background: 'rgba(46,213,115,0.08)' }}
                onClick={(e) => { e.stopPropagation(); startEdit('rangement', record.rangement || ''); }}
              >
                <Edit3 size={10} style={{ marginRight: 3 }} />Modifier
              </button>
            </div>
          )}
        </div>

      </div>

      {record.type_anomalie === 'STATUT_INCONNU' && onForceStock && (
        <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ fontSize: 13, color: '#f59e0b', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
            <AlertCircle size={14} /> 
            {(() => {
              const match = record.erreur_message?.match(/Statut inconnu "([^"]+)"/);
              const statusStr = match ? match[1] : '';
              return (
                <span>
                  Cette carte a un statut inconnu {statusStr ? <strong>"{statusStr}"</strong> : ''} mais a été sauvegardée en stock.
                </span>
              );
            })()}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onForceStock(); }}
            disabled={isDeleting}
            style={{
              background: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              color: '#10b981',
              padding: '6px 14px',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            {isDeleting ? <RefreshCw size={14} className="spin" /> : <Save size={14} />}
            Valider et Forcer en Stock
          </button>
        </div>
      )}
    </div>
  );
}
