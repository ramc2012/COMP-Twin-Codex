/**
 * UnitContext - Provides global access to current unit selection
 */
import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { fetchUnits, type UnitSummary } from '../lib/api';

interface UnitContextType {
    unitId: string;
    setUnitId: (id: string) => void;
    units: UnitSummary[];
    loading: boolean;
    activeUnit: UnitSummary | null;
    stageCount: number;
    refreshUnits: () => Promise<void>;
    availableUnits: string[]; // Keep for backward compatibility if needed
    pollIntervalMs: number;
    setPollIntervalMs: (ms: number) => void;
}

const UnitContext = createContext<UnitContextType | undefined>(undefined);

const DEFAULT_UNITS: UnitSummary[] = [
    { unit_id: 'GCS-001', name: 'Compressor Package A', stage_count: 3, is_active: true, has_modbus: true },
    { unit_id: 'GCS-002', name: 'Compressor Package B', stage_count: 3, is_active: true, has_modbus: true },
    { unit_id: 'GCS-003', name: 'Compressor Package C', stage_count: 2, is_active: true, has_modbus: true }
];

export function UnitProvider({ children }: { children: ReactNode }) {
    const [unitId, setUnitId] = useState<string>(() => {
        return localStorage.getItem('last_unit_id') || 'GCS-001';
    });
    const [pollIntervalMs, setPollIntervalMsState] = useState<number>(() => {
        const raw = Number(localStorage.getItem('gcp_poll_interval_ms') || 2000);
        return Number.isFinite(raw) ? Math.max(1000, Math.min(60000, raw)) : 2000;
    });
    const [units, setUnits] = useState<UnitSummary[]>(DEFAULT_UNITS);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        localStorage.setItem('last_unit_id', unitId);
    }, [unitId]);

    useEffect(() => {
        localStorage.setItem('gcp_poll_interval_ms', String(pollIntervalMs));
    }, [pollIntervalMs]);

    const setPollIntervalMs = (ms: number) => {
        if (!Number.isFinite(ms)) return;
        setPollIntervalMsState(Math.max(1000, Math.min(60000, Math.round(ms))));
    };

    const loadUnits = async (isMounted?: () => boolean) => {
        const canUpdate = () => (isMounted ? isMounted() : true);
        try {
            const response = await fetchUnits();
            if (!canUpdate()) return;
            const backendUnits = response.units || [];
            setUnits(backendUnits.length ? backendUnits : DEFAULT_UNITS);
        } catch {
            if (canUpdate()) setUnits(DEFAULT_UNITS);
        } finally {
            if (canUpdate()) setLoading(false);
        }
    };

    useEffect(() => {
        let mounted = true;
        const safeLoad = () => loadUnits(() => mounted);

        safeLoad();
        const refreshTimer = setInterval(safeLoad, Math.max(15000, pollIntervalMs * 10));

        return () => {
            mounted = false;
            clearInterval(refreshTimer);
        };
    }, [pollIntervalMs]);

    useEffect(() => {
        if (!units.find((u) => u.unit_id === unitId) && units.length > 0) {
            setUnitId(units[0].unit_id);
        }
    }, [units, unitId]);

    const activeUnit = units.find((u) => u.unit_id === unitId) || null;
    const stageCount = activeUnit?.stage_count ?? 3;

    return (
        <UnitContext.Provider value={{ 
            unitId, 
            setUnitId, 
            units, 
            loading, 
            activeUnit,
            stageCount,
            refreshUnits: async () => {
                setLoading(true);
                await loadUnits();
            },
            availableUnits: units.map(u => u.unit_id),
            pollIntervalMs,
            setPollIntervalMs,
        }}>
            {children}
        </UnitContext.Provider>
    );
}

export function useUnit() {
    const context = useContext(UnitContext);
    if (!context) {
        throw new Error('useUnit must be used within a UnitProvider');
    }
    return context;
}
