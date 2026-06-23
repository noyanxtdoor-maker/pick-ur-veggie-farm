// Accept invitation (M1C §8.6). The signed-in invitee redeems a token → accept_invitation() RPC (single-use,
// expiry enforced server-side). Online action.
import {useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {CheckCircle2} from 'lucide-react';
import {supabase} from '../core/supabase/client';
import {Button, Card} from '../components/ui';
import {TextInput} from '../components/forms';

export default function AcceptInvitation() {
  const [params] = useSearchParams();
  const [token, setToken] = useState(params.get('token') ?? '');
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function accept() {
    setState('working');
    const {error} = await supabase.rpc('accept_invitation', {p_token: token});
    if (error) {
      setState('error');
      setMessage(error.message);
    } else {
      setState('done');
      setMessage('You have joined the company. You can now use the app.');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <Card className="w-full max-w-md">
        <h1 className="mb-4 text-2xl font-bold">Accept invitation</h1>
        {state === 'done' ? (
          <p className="flex items-center gap-2 text-lg text-emerald-800"><CheckCircle2 aria-hidden /> {message}</p>
        ) : (
          <div className="space-y-4">
            <TextInput value={token} onChange={(e) => setToken(e.target.value)} placeholder="Invitation token" className="font-mono text-sm" />
            {state === 'error' ? <p className="text-base font-medium text-red-700" role="alert">{message}</p> : null}
            <Button className="w-full" disabled={!token || state === 'working'} onClick={() => void accept()}>
              {state === 'working' ? 'Accepting…' : 'Accept invitation'}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
