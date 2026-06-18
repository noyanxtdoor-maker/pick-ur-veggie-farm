import React from 'react';
import { Delete, Trash2 } from 'lucide-react';

interface NumpadProps {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
  type: 'weight' | 'cash';
}

export function Numpad({ value, onChange, disabled = false, type }: NumpadProps) {
  const handleKeyClick = (key: string) => {
    if (disabled) return;

    if (key === '⌫') {
      onChange(value.length > 0 ? value.substring(0, value.length - 1) : '');
    } else if (key === 'C') {
      onChange('');
    } else if (key === '.') {
      if (!value.includes('.')) {
        onChange(value === '' ? '0.' : value + '.');
      }
    } else {
      onChange(value + key);
    }
  };

  const handleChipClick = (amount: number) => {
    if (disabled) return;
    const currentNum = parseFloat(value) || 0;
    const precision = type === 'weight' ? 3 : 2;
    onChange((currentNum + amount).toFixed(precision).replace(/\.?0+$/, '')); // trim trailing decimals if integer
  };

  const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫'];
  const weightChips = [0.25, 0.5, 1.0, 2.0, 5.0];
  const cashChips = [20, 50, 100, 500, 1000];

  const chips = type === 'weight' ? weightChips : cashChips;
  const prefix = type === 'weight' ? '+' : '+₱';

  return (
    <div className={`space-y-4 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {/* Keyboard Grid */}
      <div className="grid grid-cols-3 gap-2">
        {keys.map((key) => (
          <button
            key={key}
            type="button"
            disabled={disabled}
            onClick={() => handleKeyClick(key)}
            className="h-14 font-extrabold text-lg flex items-center justify-center rounded-2xl border border-farm-accent bg-white text-farm-green-700 hover:bg-farm-accent-soft hover:text-farm-green active:bg-farm-green active:text-white transition duration-100 cursor-pointer focus:outline-none select-none touch-action-manipulation"
          >
            {key === '⌫' ? <Delete className="w-5 h-5" /> : key}
          </button>
        ))}
      </div>

      {/* Quick Add Chips */}
      <div className="flex flex-wrap gap-1.5 justify-between">
        {chips.map((num) => (
          <button
            key={num}
            type="button"
            disabled={disabled}
            onClick={() => handleChipClick(num)}
            className="flex-1 min-w-[62px] py-3 text-xs font-black rounded-xl border border-farm-accent bg-farm-accent-soft text-farm-green hover:bg-farm-accent active:bg-farm-green active:text-white transition duration-100 cursor-pointer select-none touch-action-manipulation text-center uppercase"
          >
            {prefix}{num}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={() => handleKeyClick('C')}
          className="flex-1 min-w-[62px] py-3 text-xs font-black rounded-xl border border-red-200 bg-red-50 text-farm-danger hover:bg-red-100 active:bg-farm-danger active:text-white transition duration-100 cursor-pointer select-none text-center flex items-center justify-center gap-1 uppercase"
        >
          <Trash2 className="w-3.5 h-3.5" /> Clear
        </button>
      </div>
    </div>
  );
}
