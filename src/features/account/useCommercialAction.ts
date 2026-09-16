import { useEffect, useRef, useState } from 'react';
import type { StoryDreamApi } from '../../shared/storydream-api';
import { getCommercialStore } from './commercial-store';

export function useCommercialAction(api: StoryDreamApi) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const mounted = useRef(true);
  const locked = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function run<T>(operation: () => Promise<T>, onSuccess?: (result: T) => void, successMessage = '') {
    if (locked.current) return;
    locked.current = true; setBusy(true); setMessage(''); setError('');
    const owner = getCommercialStore(api.commercial).getState().snapshot?.user?.id;
    const isCurrent = () => mounted.current && owner === getCommercialStore(api.commercial).getState().snapshot?.user?.id;
    try {
      const result = await operation();
      if (isCurrent()) { onSuccess?.(result); setMessage(successMessage); }
    } catch (failure) {
      if (isCurrent()) setError(failure instanceof Error ? failure.message : '操作失败，请稍后重试。');
    } finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  return { busy, message, error, run, clear: () => { setMessage(''); setError(''); } };
}
