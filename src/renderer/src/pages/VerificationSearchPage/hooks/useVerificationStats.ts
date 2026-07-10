import { useState, useEffect } from 'react';
import { useCacheStore } from '../../../stores/cacheStore';

export interface VerificationStats {
  today: number;
  yesterday: number;
  week: number;
  month: number;
  year: number;
  last7Days?: { dayName: string; count: number }[];
}

export function useVerificationStats(user: any) {
  const [stats, setStats] = useState<VerificationStats>({
    today: 0,
    yesterday: 0,
    week: 0,
    month: 0,
    year: 0,
    last7Days: []
  });
  const [cardsToday, setCardsToday] = useState<any[]>([]);

  const loadStats = async () => {
    if (user?.login && user?.site_id) {
      try {
        const res = await window.api.stats.getVerification(user.login, user.site_id);
        if (res) setStats(res);
      } catch (err) {
        console.error('Failed to load verification stats:', err);
      }
    }
  };

  const loadCardsToday = async () => {
    if (user?.login && user?.site_id) {
      try {
        const res = await window.api.stats.getCardsToday(user.login, user.site_id);
        if (res) setCardsToday(res);
      } catch (err) {
        console.error('Failed to load verification cards today:', err);
      }
    }
  };

  useEffect(() => {
    if (user) {
      loadStats();
      loadCardsToday();
    }
  }, [user]);

  return {
    stats,
    cardsToday,
    loadStats,
    loadCardsToday
  };
}
