// P1P: banking-app-style masked PIN entry. Distinct from pos/Numpad.tsx (that one is unmasked and
// has a decimal key for money amounts — wrong shape for a fixed-length secret). Shared by the MPIN
// onboarding step and the lock-screen unlock prompt — both need identical masked-dot + keypad UX.
import {Delete} from 'lucide-react';
import {cn} from './ui';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'] as const;

export function PinDots({length, filled}: {length: number; filled: number}) {
  return (
    <div className="flex justify-center gap-3" role="status" aria-label={`${filled} of ${length} digits entered`}>
      {Array.from({length}, (_, i) => (
        <span
          key={i}
          className={cn(
            'h-4 w-4 rounded-full border-2 border-farm-green transition-colors',
            i < filled ? 'bg-farm-green' : 'bg-transparent',
          )}
        />
      ))}
    </div>
  );
}

export function PinPad({value, onChange, length = 6}: {value: string; onChange: (next: string) => void; length?: number}) {
  function press(k: string) {
    if (!k) return;
    if (k === '⌫') return onChange(value.slice(0, -1));
    if (value.length >= length) return;
    onChange(value + k);
  }
  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="PIN keypad">
      {KEYS.map((k, i) => (
        <button
          key={`${k}-${i}`}
          type="button"
          disabled={!k}
          onClick={() => press(k)}
          className={cn(
            'min-h-14 rounded-xl border text-2xl font-bold transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-farm-green-500',
            !k && 'invisible',
            k === '⌫' ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100' : 'border-farm-accent bg-farm-card text-farm-ink hover:bg-farm-bg',
          )}
          aria-label={k === '⌫' ? 'Backspace' : k || undefined}
        >
          {k === '⌫' ? <Delete className="mx-auto" size={24} aria-hidden /> : k}
        </button>
      ))}
    </div>
  );
}
