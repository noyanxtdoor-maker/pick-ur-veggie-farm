// @vitest-environment jsdom
// Smoke test: the V3 app actually mounts — providers init, the router renders, and a real screen (Login) paints
// with its components, all in mock mode (no cloud). Validates route + component + provider initialization.
import 'fake-indexeddb/auto';
import {describe, expect, it} from 'vitest';
import {render, screen, waitFor} from '@testing-library/react';
import App from '@/app/App';

describe('V3 application renders', () => {
  it('mounts providers + router and shows the login screen (mock mode)', async () => {
    render(<App />);
    // P1 split-panel login: brand headline on the marketing panel + the two auth tabs.
    await waitFor(() => expect(screen.getAllByText(/Pick Ur Veggie/i).length).toBeGreaterThan(0), {timeout: 4000});
    expect(screen.getByRole('button', {name: /sign in/i})).toBeDefined();
    expect(screen.getByRole('button', {name: /create pos account/i})).toBeDefined();
    expect(screen.getByRole('button', {name: /log in to erp/i})).toBeDefined();
  });
});
