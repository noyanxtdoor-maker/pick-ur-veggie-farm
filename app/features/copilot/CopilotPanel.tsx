// VeggieGenius Copilot (CAP-VG1 v1, steps 2–4) — advisory chat over the user's OWN farm data.
// Grounded Morning Brief renders with ZERO model dependency (step 3); questions go to the local LM Studio
// model with the brief as context (step 4); everything degrades to the non-AI brief when the model is off
// (spec §1 failure mode). No writes, no money paths, no server surface — C7 §11 by construction.
import {useCallback, useEffect, useRef, useState} from 'react';
import {Link} from 'react-router-dom';
import {Bot, RefreshCcw, Send, Sparkles, Trash2} from 'lucide-react';
import {usePermissions} from '../../core/permissions/permissions';
import {Button, Card, PageHeader, cn} from '../../components/ui';
import {useToast} from '../../components/feedback';
import {gatherBrief, type MorningBrief} from './brief';
import {copilotApi} from './api';
import type {CopilotMessage} from '../../types/db';

export default function CopilotPanel() {
  const {companyId} = usePermissions();
  const {notify} = useToast();
  const [brief, setBrief] = useState<MorningBrief | null>(null);
  const [msgs, setMsgs] = useState<CopilotMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [modelUp, setModelUp] = useState<boolean | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(() => {
    void gatherBrief(companyId).then(setBrief);
    void copilotApi.history().then(setMsgs);
    void copilotApi.health().then(setModelUp);
  }, [companyId]);
  useEffect(reload, [reload]);
  useEffect(() => {endRef.current?.scrollIntoView({behavior: 'smooth'});}, [msgs.length, busy]);

  async function send() {
    const q = input.trim();
    if (!q || busy || !brief) return;
    setBusy(true);
    setInput('');
    try {
      const userMsg = await copilotApi.remember({chatRole: 'user', content: q});
      setMsgs((m) => [...m, userMsg]);
      const a = await copilotApi.ask(q, brief, msgs);
      const aMsg = await copilotApi.remember({chatRole: 'assistant', content: a.content, model: a.model, offline: a.offline, grounded: true});
      setMsgs((m) => [...m, aMsg]);
      setModelUp(!a.offline);
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Copilot failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="VeggieGenius Copilot"
        subtitle="Advisory only — it reads your data to explain and suggest; every action still happens through the app."
        action={
          <span className={cn('flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold',
            modelUp === null ? 'border-farm-accent text-farm-muted' : modelUp ? 'border-farm-green text-farm-green' : 'border-amber-300 bg-amber-50 text-amber-900')}>
            <Bot className="h-4 w-4" aria-hidden />
            {modelUp === null ? 'Checking model…' : modelUp ? 'Local model connected' : 'Model offline — brief still works'}
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Morning Brief — the grounded, non-AI heart of the feature */}
        <Card className="lg:col-span-1">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-base font-bold text-farm-green"><Sparkles className="h-4 w-4" aria-hidden /> Morning Brief</h3>
            <button onClick={reload} className="rounded p-1 text-farm-muted hover:text-farm-green" aria-label="Refresh brief"><RefreshCcw className="h-4 w-4" aria-hidden /></button>
          </div>
          {!brief ? (
            <p className="py-4 text-sm italic text-farm-muted">Gathering…</p>
          ) : brief.sections.length === 0 ? (
            <p className="py-2 text-sm text-farm-muted">{brief.summary}</p>
          ) : (
            <div className="space-y-3">
              {brief.sections.map((s) => (
                <div key={s.heading}>
                  <p className="text-xs font-black uppercase tracking-wide text-farm-muted">{s.heading}</p>
                  <ul className="mt-1 space-y-0.5 text-sm text-farm-ink">
                    {s.items.map((it, i) => <li key={i} className="truncate" title={it}>• {it}</li>)}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 border-t border-farm-accent-soft pt-2 text-[10px] text-farm-muted">
            Built from the same data your screens show — nothing here bypasses your permissions. Model settings live in <Link to="/settings" className="font-bold text-farm-green underline">Settings</Link>.
          </p>
        </Card>

        {/* Chat */}
        <Card className="flex min-h-[420px] flex-col lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-base font-bold text-farm-green">Ask about your farm</h3>
            {msgs.length > 0 ? (
              <button onClick={async () => {await copilotApi.clearHistory(); setMsgs([]); notify('Chat cleared');}}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs font-bold text-farm-muted hover:text-farm-danger" disabled={busy}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> Clear
              </button>
            ) : null}
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto pr-1">
            {msgs.length === 0 ? (
              <div className="py-8 text-center text-sm text-farm-muted">
                <p className="mb-2">Try: <em>“What needs my attention today?”</em> · <em>“Which invoices are unpaid?”</em> · <em>“What should I restock?”</em></p>
                <p className="text-[11px]">Answers are grounded in the Morning Brief. With the model off you still get the brief itself.</p>
              </div>
            ) : msgs.map((m) => (
              <div key={m.id} className={cn('max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm',
                m.chatRole === 'user' ? 'ml-auto bg-farm-green text-white' : 'bg-farm-bg text-farm-ink')}>
                {m.content}
                {m.chatRole === 'assistant' ? (
                  <span className="mt-1 block text-[9px] font-bold uppercase tracking-wide opacity-60">
                    {m.offline ? 'grounded brief (model offline)' : `via ${m.model ?? 'local model'}`}
                  </span>
                ) : null}
              </div>
            ))}
            {busy ? <p className="text-xs italic text-farm-muted">VeggieGenius is thinking…</p> : null}
            <div ref={endRef} />
          </div>
          <form className="mt-3 flex gap-2 border-t border-farm-accent-soft pt-3" onSubmit={(e) => {e.preventDefault(); void send();}}>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about today's schedule, stock, or receivables…"
              className="min-h-12 flex-1 rounded-xl border border-farm-accent-soft bg-farm-bg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-farm-green-500" aria-label="Ask the copilot" />
            <Button type="submit" disabled={busy || !input.trim()}><Send size={16} aria-hidden /> Ask</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
