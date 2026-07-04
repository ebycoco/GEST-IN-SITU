import React, { useState, useEffect } from 'react';

interface DateInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string;
  onChange: (val: string) => void;
  label?: React.ReactNode;
  error?: string;
}

export default function DateInput({ value, onChange, label, error, className, ...props }: DateInputProps) {
  const [inputValue, setInputValue] = useState(value);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = e.target.value.replace(/\D/g, ''); // keep only digits
    if (val.length > 8) val = val.substring(0, 8); // max 8 digits

    let formatted = '';
    if (val.length > 0) {
      formatted += val.substring(0, 2);
    }
    if (val.length >= 3) {
      formatted += '/' + val.substring(2, 4);
    }
    if (val.length >= 5) {
      formatted += '/' + val.substring(4, 8);
    }

    setInputValue(formatted);
    // Only trigger onChange if it's potentially valid or empty
    onChange(formatted);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // allow backspace, delete, tab, arrows, enter
    const allowed = ['Backspace', 'Delete', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'];
    if (allowed.includes(e.key) || e.ctrlKey || e.metaKey) return;
    
    // block non-numeric
    if (!/^[0-9]$/.test(e.key)) {
      e.preventDefault();
    }
  };

  return (
    <div className="form-group" style={{ marginBottom: 0 }}>
      {label && (
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
            color: 'var(--text-muted)' 
          }}
        >
          {label}
        </label>
      )}
      <input
        type="text"
        className={`form-input ${className || ''} ${error ? 'border-error' : ''}`}
        placeholder="JJ/MM/AAAA"
        value={inputValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        maxLength={10}
        {...props}
      />
      {error && <span className="text-error text-xs mt-1 block">{error}</span>}
    </div>
  );
}
