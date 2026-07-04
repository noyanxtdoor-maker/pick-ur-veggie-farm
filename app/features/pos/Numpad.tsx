// Touch numpad (V2 prototype pattern, rebuilt on the V3 kit). ≥56px keys for wet/gloved fingers (M1B U2).
import {Delete} from 'lucide-react';
import {cn} from '../../components/ui';

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', '⌫'] as const;

export function Numpad({value, onChange}: {value: string; onChange: (next: string) => void}) {
  function press(k: string) {
    if (k === '⌫') return onChange(value.slice(0, -1));
    if (k === '.' && value.includes('.')) return;
    if (value.length >= 8) return;
    onChange(value === '0' && k !== '.' ? k : value + k);
  }
  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="Numeric keypad">
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          onClick={() => press(k)}
          className={cn(
            'min-h-14 rounded-xl border text-2xl font-bold transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-farm-green-500',
            k === '⌫' ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100' : 'border-farm-accent bg-farm-card text-farm-ink hover:bg-farm-bg',
          )}
          aria-label={k === '⌫' ? 'Backspace' : k}
        >
          {k === '⌫' ? <Delete className="mx-auto" size={24} aria-hidden /> : k}
        </button>
      ))}
    </div>
  );
}
