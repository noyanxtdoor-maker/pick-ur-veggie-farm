// V3 application root — composes the providers (M1B stack) around the router. ODR-001: a fresh app, NOT an
// extension of the V2 prototype in src/.
import {Suspense} from 'react';
import {RouterProvider} from 'react-router-dom';
import {SessionProvider} from './core/auth/session';
import {PermissionProvider} from './core/permissions/permissions';
import {SyncProvider} from './core/offline/sync';
import {LockProvider} from './core/security/lock';
import {router} from './core/routing/router';
import {ErrorBoundary, Loading, ToastProvider} from './components/feedback';

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <SessionProvider>
          <PermissionProvider>
            <SyncProvider>
              <LockProvider>
                <Suspense fallback={<Loading label="Starting…" />}>
                  <RouterProvider router={router} />
                </Suspense>
              </LockProvider>
            </SyncProvider>
          </PermissionProvider>
        </SessionProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
