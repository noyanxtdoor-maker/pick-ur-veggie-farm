import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import {seedMockData} from './core/mock/mock';
import {initTheme} from './core/prefs/prefs';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');
const rootEl = root;

// Seed demo data first (no-op unless mock/offline-dev mode), so the app is navigable without the cloud DB.
async function start(): Promise<void> {
  initTheme(); // paint the saved theme before first render (no flash)
  await seedMockData();
  createRoot(rootEl).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
void start();
