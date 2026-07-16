import React from 'react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OnlineBadge: React.FC<{ borderColor?: string }> = ({ borderColor = 'transparent' }) => {
  const isOnline = useOnlineStatus();
  return (
    <span style={{
      position: 'absolute',
      top: -4,
      right: -4,
      width: 12,
      height: 12,
      borderRadius: '50%',
      background: isOnline ? '#2ecc71' : '#9ca3af',
      border: `2px solid ${borderColor}`,
      boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
      zIndex: 10
    }} title={isOnline ? "En ligne" : "Hors-ligne"} />
  );
};
