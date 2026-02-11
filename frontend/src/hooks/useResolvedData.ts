/**
 * Custom hook to fetch resolved data (values + quality sources)
 * Polls the backend every second.
 */
import { useState, useEffect } from 'react';
import { fetchResolvedData, type LiveDataResponse } from '../lib/api';

export function useResolvedData(unitId: string) {
    const [data, setData] = useState<LiveDataResponse | null>(null);
    const [error, setError] = useState<Error | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let mounted = true;
        const poll = async () => {
            try {
                const result = await fetchResolvedData(unitId);
                if (mounted) {
                    setData(result);
                    setError(null);
                    setLoading(false);
                }
            } catch (e) {
                if (mounted) {
                    console.error('Failed to fetch resolved data:', e);
                    setError(e as Error);
                    setLoading(false);
                }
            }
        };

        // Initial fetch
        poll();

        // Poll every 1s
        const interval = setInterval(poll, 1000);

        return () => {
            mounted = false;
            clearInterval(interval);
        };
    }, [unitId]);

    return {
        data: data || {},
        sources: data?.sources || {},
        loading,
        error
    };
}
