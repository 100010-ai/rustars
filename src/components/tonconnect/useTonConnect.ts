'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface UseTonConnectReturn {
  connected: boolean;
  address: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

export function useTonConnect(): UseTonConnectReturn {
  const [connected, setConnected] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const tcRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { TonConnectUI } = await import('@tonconnect/ui');
        const tc = new TonConnectUI({
          manifestUrl: `${window.location.origin}/tonconnect-manifest.json`,
        });
        if (cancelled) return;
        tcRef.current = tc;

        tc.onStatusChange((wallet: any) => {
          if (cancelled) return;
          if (wallet) {
            setConnected(true);
            setAddress(wallet.address);
          } else {
            setConnected(false);
            setAddress(null);
          }
        });

        // Check existing connection via account property
        const account = tc.account;
        if (account && account.address && !cancelled) {
          setConnected(true);
          setAddress(account.address);
        }
      } catch { /* TON Connect not available */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const connect = useCallback(async () => {
    const tc = tcRef.current;
    if (!tc) return;
    await tc.openModal();
  }, []);

  const disconnect = useCallback(() => {
    const tc = tcRef.current;
    if (!tc) return;
    tc.disconnect();
    setConnected(false);
    setAddress(null);
  }, []);

  return { connected, address, connect, disconnect };
}
