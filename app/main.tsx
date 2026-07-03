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

// PWA: register the service worker in production only (keeps Vite HMR untouched in dev). Enables offline
// shell load + install/TWA eligibility — the first step toward Google Play (docs Phase_2_Google_Play_Readiness.md).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js');
  });
}
