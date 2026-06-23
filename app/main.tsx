import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import {seedMockData} from './core/mock/mock';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');
const rootEl = root;

// Seed demo data first (no-op unless mock/offline-dev mode), so the app is navigable without the cloud DB.
async function start(): Promise<void> {
  await seedMockData();
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
void start();
