import { useAuthStore } from '../../stores/authStore';
import { useDashboardStats } from './hooks/useDashboardStats';
import { useForceSyncActions } from './hooks/useForceSyncActions';
import { GovernanceView } from './components/GovernanceView';
import { SiteAdminView } from './components/SiteAdminView';
import { OperatorView } from './components/OperatorView';
import { useState, useEffect } from 'react';

export default function DashboardPage() {
  const { user, activeSiteId } = useAuthStore();
  const isGovernanceView = user?.role === 'SUPER ADMIN' && !activeSiteId;
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const {
    stats,
    globalStats,
    sites,
    loading,
    operatorTodayCount,
    operatorRecentSaisies,
    siteSaisiesStats,
    siteQualiteStats,
    siteLogistiqueStats,
    dirtyCartesCount,
    dirtyUsersCount,
    cloudCartesCount,
    totalCloudCartesCount,
    detailedSyncStats,
    loadGlobalData,
    loadStats
  } = useDashboardStats(user, activeSiteId, isGovernanceView);

  const {
    isForceSyncing,
    forceSyncResult,
    isSiteSyncing,
    isSyncingAgents,
    isPullingCards,
    isBackgroundPulling,
    isBulkUploading,
    bulkProgress,
    downstreamProgress,
    downstreamInfo,
    isClearingCloud,
    purgeCloudProgress,
    handleForceGlobalSync,
    handleForceSiteSync,
    handleForceAgentsSync,
    handlePullSiteCards,
    handleStartBulkUpload,
    handleClearCloudDatabase
  } = useForceSyncActions(user, activeSiteId, loadStats);


  // ⚠️ Le pull automatique au montage a été supprimé.
  // Il est désormais géré exclusivement par le SyncEngine (triggerAutoDownstream),
  // déclenché 10 secondes après le login côté Main Process.
  // Supprimer cet useEffect évite le double downstream concurrent → "database is locked".



  if (isGovernanceView) {
    return (
      <GovernanceView
        globalStats={globalStats}
        sites={sites}
        loadGlobalData={loadGlobalData}
        isForceSyncing={isForceSyncing}
        forceSyncResult={forceSyncResult}
        handleForceGlobalSync={handleForceGlobalSync}
        loading={loading}
      />
    );
  }

  if (user?.role === 'OPERATEUR_SAISIE') {
    return (
      <OperatorView
        operatorTodayCount={operatorTodayCount}
        operatorRecentSaisies={operatorRecentSaisies}
        dirtyCartesCount={dirtyCartesCount}
        cloudCartesCount={cloudCartesCount}
        isOnline={isOnline}
        isPullingCards={isPullingCards && !isBackgroundPulling}
        isBulkUploading={isBulkUploading}
        handleStartBulkUpload={handleStartBulkUpload}
        handlePullSiteCards={handlePullSiteCards}
        loading={loading}
      />
    );
  }

  return (
    <SiteAdminView
      stats={stats}
      siteSaisiesStats={siteSaisiesStats}
      siteQualiteStats={siteQualiteStats}
      siteLogistiqueStats={siteLogistiqueStats}
      dirtyCartesCount={dirtyCartesCount}
      dirtyUsersCount={dirtyUsersCount}
      cloudCartesCount={cloudCartesCount}
      totalCloudCartesCount={totalCloudCartesCount}
      detailedSyncStats={detailedSyncStats}
      isOnline={isOnline}
      user={user}
      activeSiteId={activeSiteId}
      loadStats={loadStats}
      isSiteSyncing={isSiteSyncing}
      isSyncingAgents={isSyncingAgents}
      isPullingCards={isPullingCards && !isBackgroundPulling}
      isBackgroundPulling={isBackgroundPulling}
      isBulkUploading={isBulkUploading}
      bulkProgress={bulkProgress}
      downstreamProgress={downstreamProgress}
      downstreamInfo={downstreamInfo}
      isClearingCloud={isClearingCloud}
      purgeCloudProgress={purgeCloudProgress}
      handleForceSiteSync={handleForceSiteSync}
      handleForceAgentsSync={handleForceAgentsSync}
      handlePullSiteCards={handlePullSiteCards}
      handleStartBulkUpload={handleStartBulkUpload}
      handleClearCloudDatabase={handleClearCloudDatabase}
      loading={loading}
    />
  );
}
export { DashboardPage };
