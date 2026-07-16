import React, { useState, useEffect } from 'react';
import { ArrowDownToLine, AlertTriangle, RefreshCw, CheckCircle2 } from 'lucide-react';

interface UpdateRequiredBlockerProps {
  info: {
    currentVersion: string;
    minVersion: string;
    latestVersion: string;
    releaseNotes: string;
  };
}

export const UpdateRequiredBlocker: React.FC<UpdateRequiredBlockerProps> = ({ info }) => {
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<any>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!window.api?.updater) return;

    const unsubProgress = window.api.updater.onDownloadProgress((prog: any) => {
      setProgress(prog);
    });
    
    const unsubDownloaded = window.api.updater.onUpdateDownloaded(() => {
      setDownloading(false);
      setDownloaded(true);
      setProgress(null);
    });

    const unsubError = window.api.updater.onError((errStr: string) => {
      setDownloading(false);
      setError(errStr);
    });

    return () => {
      unsubProgress();
      unsubDownloaded();
      unsubError();
    };
  }, []);

  const handleDownload = async () => {
    if (!window.api?.updater) return;
    setDownloading(true);
    setError(null);
    const res = await window.api.updater.download();
    if (!res.success) {
      setDownloading(false);
      setError(res.error || 'Erreur lors du téléchargement');
    }
  };

  const handleInstall = async () => {
    if (!window.api?.updater) return;
    const res = await window.api.updater.install();
    if (!res.success) {
      setError(res.error || "Erreur lors de l'installation");
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-[#0a0e27] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-[#13193a] border border-[#2a3158] rounded-xl shadow-2xl p-8 flex flex-col items-center text-center">
        <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mb-6">
          <AlertTriangle className="w-8 h-8 text-red-500" />
        </div>
        
        <h2 className="text-2xl font-bold text-white mb-2">Mise à jour requise</h2>
        <p className="text-gray-400 mb-6">
          Votre version actuelle ({info.currentVersion}) est obsolète. 
          Pour continuer à utiliser GEST-IN-SITU, vous devez installer la version {info.latestVersion}.
        </p>

        {error && (
          <div className="w-full bg-red-500/10 border border-red-500/20 rounded-lg p-3 mb-6 text-sm text-red-400">
            {error}
          </div>
        )}

        {downloaded ? (
          <div className="w-full flex flex-col items-center">
            <div className="w-12 h-12 bg-green-500/20 rounded-full flex items-center justify-center mb-4">
              <CheckCircle2 className="w-6 h-6 text-green-500" />
            </div>
            <p className="text-green-400 mb-6">Mise à jour prête à être installée</p>
            <button
              onClick={handleInstall}
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-medium py-3 px-4 rounded-lg flex items-center justify-center transition-all"
            >
              <RefreshCw className="w-5 h-5 mr-2" />
              Redémarrer et Installer
            </button>
          </div>
        ) : downloading ? (
          <div className="w-full">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-blue-400">Téléchargement en cours...</span>
              <span className="text-gray-400">{progress ? Math.round(progress.percent) : 0}%</span>
            </div>
            <div className="w-full h-2 bg-[#0a0e27] rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${progress ? progress.percent : 0}%` }}
              />
            </div>
            {progress && (
              <p className="text-xs text-gray-500 mt-2">
                {Math.round(progress.bytesPerSecond / 1024 / 1024)} MB/s
              </p>
            )}
          </div>
        ) : (
          <button
            onClick={handleDownload}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white font-medium py-3 px-4 rounded-lg flex items-center justify-center transition-all"
          >
            <ArrowDownToLine className="w-5 h-5 mr-2" />
            Télécharger la mise à jour
          </button>
        )}
      </div>
    </div>
  );
};
