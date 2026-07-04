// Accessible overlays via Radix (shadcn-style). ConfirmDialog gates every effecting action (Section 25
// error prevention); SelectField is the minimal-typing input (Section 25). Large targets, high contrast.
import * as Dialog from '@radix-ui/react-dialog';
import * as RSelect from '@radix-ui/react-select';
import {Check, ChevronDown} from 'lucide-react';
import {Button} from './ui';

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => {if (!o) onCancel();}}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-farm-card p-6 shadow-xl">
          <Dialog.Title className="text-2xl font-bold text-farm-ink">{title}</Dialog.Title>
          <Dialog.Description className="mt-2 text-lg text-farm-muted">{description}</Dialog.Description>
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
            <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
              {busy ? 'Working…' : confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export interface Option {
  value: string;
  label: string;
}

export function SelectField({
  id,
  value,
  onChange,
  options,
  placeholder = 'Select…',
}: {
  id?: string;
  value: string | undefined;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
}) {
  return (
    <RSelect.Root value={value && value.length > 0 ? value : undefined} onValueChange={onChange}>
      <RSelect.Trigger
        id={id}
        className="inline-flex min-h-14 w-full items-center justify-between rounded-xl border border-farm-accent bg-farm-card px-4 text-lg text-farm-ink focus:outline-none focus:ring-2 focus:ring-farm-green-500"
      >
        <RSelect.Value placeholder={placeholder} />
        <RSelect.Icon><ChevronDown size={20} aria-hidden /></RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content position="popper" sideOffset={4} className="z-50 max-h-72 overflow-auto rounded-xl border border-farm-accent-soft bg-farm-card shadow-lg">
          <RSelect.Viewport className="p-1">
            {options.map((o) => (
              <RSelect.Item
                key={o.value}
                value={o.value}
                className="flex min-h-14 cursor-pointer select-none items-center justify-between rounded-lg px-3 text-lg text-farm-ink outline-none data-[highlighted]:bg-farm-accent-soft"
              >
                <RSelect.ItemText>{o.label}</RSelect.ItemText>
                <RSelect.ItemIndicator><Check size={18} aria-hidden /></RSelect.ItemIndicator>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}
