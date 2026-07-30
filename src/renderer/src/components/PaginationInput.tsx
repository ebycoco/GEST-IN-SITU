import React, { useState, useEffect } from 'react';

interface PaginationInputProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
}

export function PaginationInput({ currentPage, totalPages, onPageChange, disabled = false }: PaginationInputProps) {
  const [inputValue, setInputValue] = useState(currentPage.toString());

  useEffect(() => {
    setInputValue(currentPage.toString());
  }, [currentPage]);

  const handleBlur = () => {
    commitChange();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      commitChange();
    }
  };

  const commitChange = () => {
    let parsed = parseInt(inputValue, 10);
    if (isNaN(parsed)) {
      setInputValue(currentPage.toString());
      return;
    }
    if (parsed < 1) parsed = 1;
    if (parsed > totalPages) parsed = totalPages;
    if (parsed !== currentPage) {
      onPageChange(parsed);
    } else {
      setInputValue(currentPage.toString());
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.05)', borderRadius: 6, padding: '2px 6px' }}>
      <input
        type="number"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        min={1}
        max={totalPages}
        disabled={disabled}
        style={{
          width: '50px',
          background: 'transparent',
          border: 'none',
          color: 'white',
          textAlign: 'center',
          fontSize: 13,
          outline: 'none',
          MozAppearance: 'textfield' // removes arrows in firefox
        }}
      />
      <span style={{ fontSize: 13, color: 'var(--text-muted)', paddingRight: '6px' }}>
        / {totalPages}
      </span>
      <style>{`
        input[type="number"]::-webkit-inner-spin-button, 
        input[type="number"]::-webkit-outer-spin-button { 
          -webkit-appearance: none; 
          margin: 0; 
        }
      `}</style>
    </div>
  );
}
