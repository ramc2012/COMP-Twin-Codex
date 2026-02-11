/**
 * Dashboard - Main overview page with live data from compressor system
 * Updated for Phase 7: Uses UnitContext for multi-unit support
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDataStore } from '../store/useDataStore';
import { useUnit } from '../contexts/UnitContext';
import { fetchLiveData, createWebSocket } from '../lib/api';
import { MetricCard } from '../components/MetricCard';
import { StageCard } from '../components/StageCard';

const ENGINE_STATES: Record<number, { label: string; color: string }> = {
    0: { label: 'STOPPED', color: 'bg-slate-500' },
    1: { label: 'READY', color: 'bg-yellow-500' },
    2: { label: 'PRELUBE', color: 'bg-blue-500' },
    3: { label: 'CRANK', color: 'bg-blue-500' },
    4: { label: 'IGNITION', color: 'bg-amber-500' },
    5: { label: 'WARMUP', color: 'bg-orange-500' },
    6: { label: 'LOADING', color: 'bg-cyan-500' },
    7: { label: 'LOADED', color: 'bg-emerald-500' },
    8: { label: 'RUNNING', color: 'bg-emerald-500 animate-pulse' },
    9: { label: 'COOLDOWN', color: 'bg-orange-500' },
    10: { label: 'SHUTDOWN', color: 'bg-red-500' },
    16: { label: 'UNLOADING', color: 'bg-amber-500' },
    32: { label: 'COOLDOWN', color: 'bg-orange-500' },
    64: { label: 'SHUTDOWN', color: 'bg-red-500' },
    255: { label: 'FAULT', color: 'bg-red-600 animate-pulse' },
};

export function Dashboard() {
    const navigate = useNavigate();
    const { unitId, setUnitId, units } = useUnit();
    const { liveData, isLoading, error, setLiveData, setError } = useDataStore();
    const [wsConnected, setWsConnected] = useState(false);

    useEffect(() => {
        let isMounted = true;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
        let pollTimer: ReturnType<typeof setInterval> | null = null;
        let ws: WebSocket | null = null;
        let hasReceivedData = false;
        let wsActive = false;

        const applyLiveData = (payload: any) => {
            if (!isMounted || !payload) return;
            if (typeof payload.engine_state !== 'number') return;
            setLiveData(payload as any);
            setError(null);
            hasReceivedData = true;
        };

        const connectWebSocket = () => {
            if (!isMounted) return;
            ws = createWebSocket(
                unitId,
                (msg) => {
                    if (msg.type === 'LIVE_DATA' || msg.type === 'RESOLVED_DATA') {
                        applyLiveData(msg.data);
                        wsActive = true;
                        setWsConnected(true);
                    }
                },
                () => {
                    wsActive = false;
                    setWsConnected(false);
                }
            );

            ws.onopen = () => {
                wsActive = true;
                setWsConnected(true);
            };
            ws.onclose = () => {
                wsActive = false;
                setWsConnected(false);
                if (isMounted) {
                    reconnectTimer = setTimeout(connectWebSocket, 2000);
                }
            };
        };

        const fetchData = async () => {
            // WebSocket stream is primary; poll only as fallback.
            if (wsActive) return;
            try {
                const data = await fetchLiveData(unitId);
                applyLiveData(data);
            } catch (e: any) {
                // Keep last good data to avoid UI flicker on transient request failures.
                if (!hasReceivedData) {
                    setError(`Failed to fetch data: ${e?.message || e}`);
                }
            }
        };

        fetchData();

        // Poll less aggressively, WebSocket remains primary.
        pollTimer = setInterval(fetchData, 2000);
        connectWebSocket();

        return () => {
            isMounted = false;
            setWsConnected(false);
            if (pollTimer) clearInterval(pollTimer);
            if (reconnectTimer) clearTimeout(reconnectTimer);
            if (ws && ws.readyState <= 1) ws.close();
        };
    }, [unitId, setLiveData, setError]);

    if (isLoading && !liveData) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="text-xl text-slate-400">
                    <span className="animate-spin inline-block mr-3">⟳</span>
                    Loading live data for {unitId}...
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex items-center justify-center h-screen">
                <div className="glass-card p-8 text-center max-w-md">
                    <div className="text-4xl mb-4">⚠️</div>
                    <h2 className="text-xl font-semibold text-red-400 mb-2">Connection Error</h2>
                    <p className="text-slate-400">{error}</p>
                    <p className="text-sm text-slate-500 mt-4">Make sure the backend is running on port 8000</p>
                </div>
            </div>
        );
    }

    if (!liveData) return null;

    const engineState = ENGINE_STATES[liveData.engine_state] || { label: 'UNKNOWN', color: 'bg-slate-500' };
    
    // Cast to any to access sources
    const sources = (liveData as any).sources || {};

    // Helper to get quality for a parameter
    const getQuality = (param: string): any => {
        return sources[param] || 'LIVE';
    };

    return (
        <div className="min-h-screen p-6">
            {/* Header */}
            <header className="mb-8">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                            GCS Digital Twin
                        </h1>
                        <p className="text-slate-400 mt-1">Unit: {unitId}</p>
                        <div className="flex gap-2 mt-3 flex-wrap">
                            {units.map((unit, index) => (
                                <button
                                    key={unit.unit_id}
                                    type="button"
                                    onClick={() => {
                                        setUnitId(unit.unit_id);
                                        navigate(`/packages/${unit.unit_id}/dashboard`);
                                    }}
                                    className={`px-3 py-1.5 rounded-lg text-xs border ${
                                        unitId === unit.unit_id
                                            ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-300'
                                            : 'bg-slate-800/50 border-slate-700/60 text-slate-300 hover:border-slate-500/60'
                                    }`}
                                >
                                    Package {index + 1} ({unit.unit_id})
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center gap-6">
                        {/* Legend for Quality */}
                        <div className="flex items-center gap-3 text-xs text-slate-400 bg-slate-800/50 px-3 py-1.5 rounded-full border border-slate-700">
                            <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-500"></div> Live</span>
                            <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-amber-500"></div> Manual</span>
                        </div>

                        {/* Connection status */}
                        <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                            <span className="text-sm text-slate-400">
                                {wsConnected ? 'WebSocket' : 'Polling'}
                            </span>
                        </div>

                        {/* Engine state badge */}
                        <div className={`px-4 py-2 rounded-full ${engineState.color} text-white font-semibold shadow-lg`}>
                            {engineState.label}
                        </div>

                        {/* Hour meter */}
                        <div className="text-right">
                            <span className="text-xs text-slate-400">Hour Meter</span>
                            <div className="text-xl font-mono text-white">{liveData.hour_meter?.toFixed(1) || 'N/A'}</div>
                        </div>

                        {/* Timestamp */}
                        <div className="text-right">
                            <span className="text-xs text-slate-400">Last Update</span>
                            <div className="text-sm text-slate-300">
                                {new Date(liveData.timestamp).toLocaleTimeString()}
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            {/* Engine & Compressor Vitals Row */}
            <section className="mb-6">
                <h2 className="text-lg font-semibold text-slate-300 mb-4">Engine & Compressor Vitals</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    <MetricCard
                        title="Engine RPM"
                        value={liveData.engine_rpm}
                        unit="RPM"
                        icon="⚙️"
                        status="normal"
                        quality={getQuality('engine_rpm')}
                    />
                    <MetricCard
                        title="Engine Oil Pressure"
                        value={liveData.engine_oil_press}
                        unit="PSIG"
                        icon="🛢️"
                        status={liveData.engine_oil_press < 40 ? 'warning' : 'normal'}
                        quality={getQuality('engine_oil_press')}
                    />
                    <MetricCard
                        title="Engine Oil Temp"
                        value={liveData.engine_oil_temp}
                        unit="°F"
                        icon="🌡️"
                        status={liveData.engine_oil_temp > 200 ? 'warning' : 'normal'}
                        quality={getQuality('engine_oil_temp')}
                    />
                    <MetricCard
                        title="Jacket Water"
                        value={liveData.jacket_water_temp}
                        unit="°F"
                        icon="💧"
                        status={liveData.jacket_water_temp > 200 ? 'warning' : 'normal'}
                        quality={getQuality('jacket_water_temp')}
                    />
                    <MetricCard
                        title="Comp Oil Pressure"
                        value={liveData.comp_oil_press}
                        unit="PSIG"
                        icon="🛢️"
                        quality={getQuality('comp_oil_press')}
                    />
                    <MetricCard
                        title="Comp Oil Temp"
                        value={liveData.comp_oil_temp}
                        unit="°F"
                        icon="🌡️"
                        quality={getQuality('comp_oil_temp')}
                    />
                </div>
            </section>

            {/* Compression Stages */}
            <section className="mb-6">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-slate-300">Compression Stages</h2>
                    <div className="flex items-center gap-4">
                        <div className="text-right">
                            <span className="text-xs text-slate-400">Overall Ratio</span>
                            <div className="text-2xl font-bold text-purple-400">{liveData.overall_ratio}</div>
                        </div>
                        <div className="text-right">
                            <span className="text-xs text-slate-400">Total BHP</span>
                            <div className="text-2xl font-bold text-cyan-400">{liveData.total_bhp}</div>
                        </div>
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {liveData.stages?.map((stage: any) => (
                        <StageCard key={stage.stage} data={stage} />
                    )) || <div className="text-slate-400">No stage data available</div>}
                </div>
            </section>

            {/* Exhaust Temps, Bearings, Controls - abbreviated for brevity */}
            <section className="mb-6">
                <h2 className="text-lg font-semibold text-slate-300 mb-4">System Status</h2>
                <div className="glass-card p-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="text-center">
                            <span className="text-xs text-slate-400">Exhaust Spread</span>
                            <div className={`text-xl font-bold ${(liveData.exhaust_spread || 0) > 75 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                {liveData.exhaust_spread?.toFixed(1) || 'N/A'}°F
                            </div>
                        </div>
                        <div className="text-center">
                            <span className="text-xs text-slate-400">Suction Valve</span>
                            <div className="text-xl font-bold text-cyan-400">{liveData.suction_valve_pct?.toFixed(1) || 'N/A'}%</div>
                        </div>
                        <div className="text-center">
                            <span className="text-xs text-slate-400">Speed Control</span>
                            <div className="text-xl font-bold text-emerald-400">{liveData.speed_control_pct?.toFixed(1) || 'N/A'}%</div>
                        </div>
                        <div className="text-center">
                            <span className="text-xs text-slate-400">Recycle Valve</span>
                            <div className="text-xl font-bold text-amber-400">{liveData.recycle_valve_pct?.toFixed(1) || 'N/A'}%</div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}
