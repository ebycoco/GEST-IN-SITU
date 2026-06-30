import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

export default function MainLayout() {
  useEffect(() => {
    if (window.api && window.api.onDatabaseUpdated) {
      const unsubscribe = window.api.onDatabaseUpdated((data) => {
        const cardCount = data.count ?? data.processedCount ?? 0;
        if (cardCount > 0) {
          toast.success(`📥 Base de données mise à jour : ${cardCount} nouvelle(s) carte(s) disponible(s) !`, {
            duration: 5000,
            style: {
              background: '#000',
              color: '#FFD700', // Couleurs thématiques Jaune/Noir Plein Soleil
              border: '1px solid #FFD700'
            }
          });
        }
      });
      return () => unsubscribe();
    }
  }, []);

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <TopBar />
        <div className="page-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
