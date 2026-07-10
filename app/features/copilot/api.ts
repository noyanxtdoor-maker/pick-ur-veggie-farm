// CAP-VG1 Step 4 — the LM Studio call (local OpenAI-compatible server), plus the client-only chat history.
// Pure client → local-model HTTP: no server, no Edge Function, no RLS surface, no money path (spec §2/§4 —
// v1 is read-only assist; C7 §11 "AI is advisory" holds by construction). OFFLINE-DEGRADE (spec §5): if the
// model is unreachable, the panel still shows the grounded (non-AI) brief and the whole ERP is unaffected.
import {offlineDB} from '../../core/offline/db';
import {getPref} from '../../core/prefs/prefs';
import {uuidv7} from '../../core/offline/uuidv7';
import {renderBriefText, type MorningBrief} from './brief';
import type {CopilotMessage} from '../../types/db';

export const LM_DEFAULT_URL = 'http://localhost:1234';
export const LM_DEFAULT_MODEL = 'owner-default'; // D2 is a Settings preference (spec §7) — any loaded model id works

export interface CopilotAnswer {
  content: string;
  model: string;
  offline: boolean; // true = degrade path (no model involved)
}

const SYSTEM_PROMPT = [
  'You are VeggieGenius, the advisory copilot inside the Pick Ur Veggie farm ERP.',
  'You help the user understand THEIR OWN farm data. You cannot write to any database, post or void any',
  'transaction, or change any permission — you only explain and suggest; the user acts through the app.',
  'Ground every answer in the brief below. If the brief has no relevant data, say exactly that — never invent',
  'numbers, invoices, or stock levels. Keep answers short and practical for a farm operator.',
].join(' ');

export const copilotApi = {
  enabled: () => getPref('copilot_enabled', '1') === '1',

  // ── local chat history (client-only, spec §3: answers are never stored server-side) ──
  async history(): Promise<CopilotMessage[]> {
    return offlineDB.copilotMessages.orderBy('timestamp').toArray();
  },
  async remember(msg: Omit<CopilotMessage, 'id' | 'timestamp'>): Promise<CopilotMessage> {
    const row: CopilotMessage = {...msg, id: uuidv7(), timestamp: Date.now()};
    await offlineDB.copilotMessages.put(row);
    return row;
  },
  async clearHistory(): Promise<void> {
    await offlineDB.copilotMessages.clear();
  },

  /** Is the local model reachable? Drives the panel's status pill. */
  async health(): Promise<boolean> {
    const url = getPref('copilot_lm_url', LM_DEFAULT_URL).replace(/\/$/, '');
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 3000);
      const res = await fetch(`${url}/v1/models`, {signal: ctl.signal});
      clearTimeout(t);
      return res.ok;
    } catch {
      return false;
    }
  },

  /**
   * Ask the model with the grounded brief as context. Never throws: model errors and unreachability
   * degrade to the grounded brief + an explicit offline notice.
   */
  async ask(question: string, brief: MorningBrief, history: CopilotMessage[]): Promise<CopilotAnswer> {
    const url = getPref('copilot_lm_url', LM_DEFAULT_URL).replace(/\/$/, '');
    const model = getPref('copilot_model', LM_DEFAULT_MODEL);
    const briefText = renderBriefText(brief);
    if (!this.enabled()) {
      return {content: 'Copilot is switched off in Settings. The rest of the ERP is unaffected.', model: 'none', offline: true};
    }
    const messages = [
      {role: 'system', content: `${SYSTEM_PROMPT}\n\n--- GROUNDED BRIEF ---\n${briefText}\n--- END BRIEF ---`},
      ...history.slice(-10).map((m) => ({role: m.chatRole, content: m.content})),
      {role: 'user', content: question},
    ];
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 30_000); // local models can be slow
      const res = await fetch(`${url}/v1/chat/completions`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({model, messages, temperature: 0.4, max_tokens: 1024}),
        signal: ctl.signal,
      });
      clearTimeout(t);
      if (!res.ok) {
        const err = await res.text().catch(() => '');
        return {content: `The local model answered with an error (HTTP ${res.status}) — ${err.slice(0, 160)}. Check the model id in Settings → VeggieGenius Copilot.`, model, offline: false};
      }
      const data = (await res.json()) as {choices?: Array<{message?: {content?: string}}>};
      return {content: data.choices?.[0]?.message?.content?.trim() || '(the model returned an empty answer)', model, offline: false};
    } catch {
      return {
        content: `Copilot is offline (no LM Studio at ${url}). Here is today's grounded brief without the AI layer:\n\n${briefText}`,
        model,
        offline: true,
      };
    }
  },
};
