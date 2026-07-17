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
    // Login screen (2026-07-13 redesign): brand headline + the two auth tabs + the submit button, which
    // shares the "Sign In" label with the tab button (getAllByRole, not getByRole, for that one).
    await waitFor(() => expect(screen.getAllByText(/Pick Ur Veggie/i).length).toBeGreaterThan(0), {timeout: 4000});
    expect(screen.getAllByRole('button', {name: /sign in/i}).length).toBeGreaterThanOrEqual(2); // tab + submit
    expect(screen.getByRole('button', {name: /create pos account/i})).toBeDefined();
    // Google sign-in is hidden in mock mode (MOCK_MODE ? null : ...) — not asserted here.
  });
});
