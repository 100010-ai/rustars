'use client';

import { useEffect, type ReactNode } from 'react';

/**
 * SecurityProvider — initializes all client-side security measures.
 *
 * - Registers service worker for network request interception
 * - Initializes anti-debug protection
 * - Sets up security-related event listeners
 */
export function SecurityProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') return;

    // ═══ Register Service Worker ═══
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          // Update service worker if new version available
          registration.addEventListener('updatefound', () => {
            const newWorker = registration.installing;
            if (newWorker) {
              newWorker.addEventListener('statechange', () => {
                if (newWorker.state === 'activated') {
                  navigator.serviceWorker.controller?.postMessage({ type: 'SKIP_WAITING' });
                }
              });
            }
          });
        })
        .catch(() => {});
    }

    // ═══ Initialize Anti-Debug ═══
    import('@/lib/security/anti-debug').then(({ initAntiDebug }) => {
      initAntiDebug();
    }).catch(() => {});

    // ═══ Block DevTools via CDP detection ═══
    // This checks if DevTools is open by monitoring window size
    let devtoolsOpen = false;
    const threshold = 160;

    const checkDevTools = () => {
      const widthThreshold = window.outerWidth - window.innerWidth > threshold;
      const heightThreshold = window.outerHeight - window.innerHeight > threshold;

      if (widthThreshold || heightThreshold) {
        if (!devtoolsOpen) {
          devtoolsOpen = true;
          // Optionally redirect or show warning
          document.body.style.opacity = '0';
          setTimeout(() => {
            document.body.style.opacity = '1';
          }, 3000);
        }
      } else {
        devtoolsOpen = false;
      }
    };

    const devtoolsInterval = setInterval(checkDevTools, 1000);

    // ═══ Prevent page from being embedded ═══
    if (window.self !== window.top) {
      try {
        window.top!.location.href = window.self.location.href;
      } catch {
        // Cross-origin — break out
        document.body.innerHTML = '<script>try{window.top.location=location}catch(e){window.top.postMessage("breakout","*")}</script>';
      }
    }

    // ═══ Disable JavaScript debugging via console ═══
    // Override toString to prevent function inspection
    const originalToString = Function.prototype.toString;
    const customToString = function(this: Function) {
      if (this === originalToString) {
        return 'function toString() { [native code] }';
      }
      return originalToString.call(this);
    };
    try {
      (Function.prototype as any).toString = customToString;
    } catch {}

    // ═══ Cleanup ═══
    return () => {
      clearInterval(devtoolsInterval);
    };
  }, []);

  return <>{children}</>;
}
