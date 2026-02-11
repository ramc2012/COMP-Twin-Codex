import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Bar,
    BarChart,
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ReferenceLine,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis
} from 'recharts';
import { useDataStore } from '../store/useDataStore';
import { useUnit } from '../contexts/UnitContext';
import { createWebSocket, fetchLiveData } from '../lib/api';
import { MetricCard } from '../components/MetricCard';

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

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function asNumber(value: any, fallback = 0): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function computeHealthScore(liveData: any): number {
    let score = 100;

    const eop = asNumber(liveData?.engine_oil_press, 0);
    if (eop < 35) score -= 18;
    else if (eop < 45) score -= 8;

    const eot = asNumber(liveData?.engine_oil_temp, 0);
    if (eot > 225) score -= 16;
    else if (eot > 205) score -= 8;

    const jwt = asNumber(liveData?.jacket_water_temp, 0);
    if (jwt > 205) score -= 14;
    else if (jwt > 190) score -= 6;

    const exhaustSpread = asNumber(liveData?.exhaust_spread, 0);
    if (exhaustSpread > 90) score -= 16;
    else if (exhaustSpread > 65) score -= 8;

    const state = String(liveData?.engine_state_label || 'UNKNOWN').toUpperCase();
    if (state === 'FAULT' || state === 'UNKNOWN') score -= 24;
    else if (state === 'STOPPED') score -= 10;

    const alarmCount = Array.isArray(liveData?.active_alarms) ? liveData.active_alarms.length : 0;
    score -= Math.min(24, alarmCount * 8);

    if (liveData?.timestamp) {
        const age = (Date.now() - new Date(liveData.timestamp).getTime()) / 1000;
        if (age > 20) score -= 12;
        else if (age > 8) score -= 6;
    }

    return clamp(Math.round(score), 0, 100);
}

function healthTone(score: number): { ring: string; text: string; label: string; badge: string } {
    if (score >= 85) return { ring: '#10b981', text: 'text-emerald-300', label: 'Healthy', badge: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/35' };
    if (score >= 65) return { ring: '#f59e0b', text: 'text-amber-300', label: 'Watch', badge: 'bg-amber-500/20 text-amber-200 border-amber-400/35' };
    return { ring: '#ef4444', text: 'text-rose-300', label: 'Critical', badge: 'bg-rose-500/20 text-rose-200 border-rose-400/35' };
}

export function Dashboard() {
    const navigate = useNavigate();
    const { unitId, setUnitId, units, pollIntervalMs } = useUnit();
    const { liveData, isLoading, error, setLiveData, setError } = useDataStore();
    const [wsConnected, setWsConnected] = useState(false);
    const [softError, setSoftError] = useState<string | null>(null);
    const [hoveredGraph, setHoveredGraph] = useState<'pressure' | 'thermal' | 'control' | null>(null);
    const legendLabel = (value: string) => <span style={{ color: '#cbd5e1' }}>{value}</span>;

    useEffect(() => {
        let isMounted = true;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
        let pollTimer: ReturnType<typeof setInterval> | null = null;
        let ws: WebSocket | null = null;
        let wsActive = false;

        const applyLiveData = (payload: any): boolean => {
            if (!isMounted || !payload) return false;
            if (typeof payload.engine_state !== 'number') {
                return false;
            }
            setLiveData(payload as any);
            setSoftError(null);
            setError(null);
            return true;
        };

        const connectWebSocket = () => {
            if (!isMounted) return;
            ws = createWebSocket(
                unitId,
                (msg) => {
                    if (msg.type === 'LIVE_DATA' || msg.type === 'RESOLVED_DATA') {
                        const ok = applyLiveData(msg.data);
                        wsActive = ok;
                        setWsConnected(ok);
                        if (!ok && useDataStore.getState().liveData) {
                            setSoftError(`Waiting for valid stream data for ${unitId}`);
                        }
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
                setSoftError(null);
                setError(null);
            };
            ws.onclose = () => {
                wsActive = false;
                setWsConnected(false);
                if (useDataStore.getState().liveData) {
                    setSoftError('Live stream disconnected. Falling back to polling...');
                } else {
                    setError('Live stream disconnected. Reconnecting...');
                }
                if (isMounted) reconnectTimer = setTimeout(connectWebSocket, Math.max(3000, pollIntervalMs * 2));
            };
        };

        const fetchData = async () => {
            if (wsActive) return;
            try {
                const data = await fetchLiveData(unitId);
                applyLiveData(data);
            } catch (e: any) {
                const message = `Failed to fetch live data: ${e?.message || e}`;
                if (useDataStore.getState().liveData) {
                    setSoftError(message);
                } else {
                    setError(message);
                }
            }
        };

        fetchData();
        pollTimer = setInterval(fetchData, pollIntervalMs);
        connectWebSocket();

        return () => {
            isMounted = false;
            setWsConnected(false);
            if (pollTimer) clearInterval(pollTimer);
            if (reconnectTimer) clearTimeout(reconnectTimer);
            if (ws && ws.readyState <= 1) ws.close();
        };
    }, [unitId, pollIntervalMs, setLiveData, setError]);

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

    if (error && !liveData) {
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
    const sources = (liveData as any).sources || {};
    const getQuality = (param: string): any => {
        const sourceAliases: Record<string, string[]> = {
            engine_oil_press: ['engine_oil_press', 'engine_oil_pressure'],
            comp_oil_press: ['comp_oil_press', 'comp_oil_pressure'],
        };
        const keys = sourceAliases[param] || [param];
        for (const key of keys) {
            if (sources[key]) return sources[key];
        }
        return 'LIVE';
    };

    const health = computeHealthScore(liveData);
    const tone = healthTone(health);

    const stages = Array.isArray(liveData.stages) ? liveData.stages : [];

    const pressureProfile = stages.map((stage: any) => ({
        stage: `S${stage.stage}`,
        suction: asNumber(stage.suction_press),
        discharge: asNumber(stage.discharge_press),
    }));

    const thermalProfile = stages.map((stage: any) => ({
        stage: `S${stage.stage}`,
        actual: asNumber(stage.discharge_temp),
        ideal: asNumber(stage.ideal_temp),
    }));

    const controlProfile = [
        { axis: 'Suction', value: asNumber(liveData.suction_valve_pct), target: 70 },
        { axis: 'Speed', value: asNumber(liveData.speed_control_pct), target: 65 },
        { axis: 'Recycle', value: asNumber(liveData.recycle_valve_pct), target: 22 },
    ];

    const riskItems: string[] = [];
    if (asNumber(liveData.engine_oil_press) < 40) riskItems.push('Engine oil pressure below preferred operating band');
    if (asNumber(liveData.engine_oil_temp) > 205) riskItems.push('Engine oil temperature elevated');
    if (asNumber(liveData.jacket_water_temp) > 195) riskItems.push('Jacket water temperature trending high');
    if (asNumber(liveData.exhaust_spread) > 70) riskItems.push('Exhaust spread indicates uneven cylinder load');
    if (!riskItems.length) riskItems.push('No immediate risk signatures from current live envelope');

    return (
        <div className="min-h-screen p-6 pb-8">
            {softError && (
                <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-200">
                    {softError}
                </div>
            )}
            <header className="mb-7 rounded-2xl border border-slate-700/60 bg-gradient-to-r from-slate-900 via-slate-900 to-cyan-950/50 p-5 md:p-6 relative overflow-hidden">
                <div className="absolute -right-20 -top-16 h-56 w-56 rounded-full bg-cyan-500/15 blur-3xl" />
                <div className="absolute -left-10 -bottom-12 h-44 w-44 rounded-full bg-violet-500/10 blur-3xl" />
                    <div className="relative flex flex-col xl:flex-row xl:items-center xl:justify-between gap-5">
                        <div>
                            <h1 className="text-3xl font-bold text-white">Compressor Health Cockpit</h1>
                            <p className="text-slate-300 mt-1">Unit {unitId} operational clarity with pressure, thermal, and control health context.</p>
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

                        <div className="flex flex-wrap items-center gap-4 md:gap-6">
                        <div className="flex items-center gap-3 text-xs text-slate-400 bg-slate-800/50 px-3 py-1.5 rounded-full border border-slate-700">
                            <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-500" />Live</span>
                            <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-amber-500" />Manual</span>
                        </div>

                            <div className="flex items-center gap-2">
                                <div className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                                <span className="text-sm text-slate-300">
                                    {wsConnected ? 'WebSocket' : 'Polling'}
                                </span>
                            </div>

                        <div className={`px-3 py-1.5 rounded-full ${engineState.color} text-white text-sm font-semibold`}>{engineState.label}</div>

                        <div className="relative h-16 w-16 rounded-full" style={{ background: `conic-gradient(${tone.ring} ${health * 3.6}deg, rgba(51,65,85,0.65) 0deg)` }}>
                            <div className="absolute inset-[6px] rounded-full bg-slate-950/95 flex flex-col items-center justify-center">
                                <span className={`text-sm font-semibold ${tone.text}`}>{health}</span>
                                <span className="text-[9px] text-slate-400">HEALTH</span>
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            <section className="grid grid-cols-1 xl:grid-cols-[1.6fr_1fr] gap-5 mb-6">
                <div className="glass-card p-5 border border-slate-700/50">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold text-slate-100">Live Operating Snapshot</h2>
                        <div className={`px-2.5 py-1 rounded-md border text-xs ${tone.badge}`}>{tone.label} Integrity</div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        <MetricCard title="Engine RPM" value={liveData.engine_rpm} unit="RPM" icon="⚙️" status="normal" quality={getQuality('engine_rpm')} />
                        <MetricCard
                            title="Engine Oil Pressure"
                            value={liveData.engine_oil_press}
                            unit="PSIG"
                            icon="🛢️"
                            status={asNumber(liveData.engine_oil_press) < 40 ? 'warning' : 'normal'}
                            quality={getQuality('engine_oil_press')}
                        />
                        <MetricCard
                            title="Engine Oil Temp"
                            value={liveData.engine_oil_temp}
                            unit="°F"
                            icon="🌡️"
                            status={asNumber(liveData.engine_oil_temp) > 205 ? 'warning' : 'normal'}
                            quality={getQuality('engine_oil_temp')}
                        />
                        <MetricCard
                            title="Jacket Water"
                            value={liveData.jacket_water_temp}
                            unit="°F"
                            icon="💧"
                            status={asNumber(liveData.jacket_water_temp) > 195 ? 'warning' : 'normal'}
                            quality={getQuality('jacket_water_temp')}
                        />
                        <MetricCard title="Comp Oil Pressure" value={liveData.comp_oil_press} unit="PSIG" icon="🛢️" quality={getQuality('comp_oil_press')} />
                        <MetricCard title="Comp Oil Temp" value={liveData.comp_oil_temp} unit="°F" icon="🌡️" quality={getQuality('comp_oil_temp')} />
                    </div>
                </div>

                <div className="glass-card p-5 border border-slate-700/50">
                    <h2 className="text-lg font-semibold text-slate-100 mb-4">Risk Radar</h2>
                    <div className="space-y-2">
                        {riskItems.map((risk, idx) => (
                            <div
                                key={`${risk}-${idx}`}
                                className={`rounded-lg border px-3 py-2 text-sm ${idx === 0 && riskItems.length > 1
                                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                                    : 'border-slate-700/60 bg-slate-900/60 text-slate-300'}`}
                            >
                                {risk}
                            </div>
                        ))}
                    </div>
                    <div className="grid grid-cols-2 gap-3 mt-4">
                        <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 p-3">
                            <div className="text-[11px] text-slate-500">Overall Ratio</div>
                            <div className="text-xl font-semibold text-violet-300">{asNumber(liveData.overall_ratio).toFixed(2)}</div>
                        </div>
                        <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 p-3">
                            <div className="text-[11px] text-slate-500">Total BHP</div>
                            <div className="text-xl font-semibold text-cyan-300">{asNumber(liveData.total_bhp).toFixed(0)}</div>
                        </div>
                        <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 p-3">
                            <div className="text-[11px] text-slate-500">Hour Meter</div>
                            <div className="text-lg font-semibold text-slate-100">{asNumber(liveData.hour_meter).toFixed(1)}</div>
                        </div>
                        <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 p-3">
                            <div className="text-[11px] text-slate-500">Last Update</div>
                            <div className="text-sm font-semibold text-slate-100">{new Date(liveData.timestamp).toLocaleTimeString()}</div>
                        </div>
                    </div>
                </div>
            </section>

            <section className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-6">
                <div
                    className="glass-card p-5 border border-slate-700/50 relative"
                    onMouseEnter={() => setHoveredGraph('pressure')}
                    onMouseLeave={() => setHoveredGraph(null)}
                >
                    <h2 className="text-lg font-semibold text-slate-100 mb-3">Pressure Ladder by Stage</h2>
                    {hoveredGraph === 'pressure' && (
                        <div className="absolute right-4 top-4 max-w-xs rounded-lg border border-cyan-500/35 bg-slate-950/90 px-3 py-2 text-[11px] text-cyan-100">
                            Compares suction and discharge pressure stage-by-stage to quickly spot compression imbalance.
                        </div>
                    )}
                    <div className="h-56">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={pressureProfile} margin={{ top: 10, right: 15, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                                <XAxis dataKey="stage" stroke="#94a3b8" tick={{ fontSize: 12 }} />
                                <YAxis stroke="#94a3b8" tick={{ fontSize: 12 }} />
                                <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }} />
                                <Legend wrapperStyle={{ fontSize: 12 }} formatter={legendLabel} />
                                <Bar dataKey="suction" name="Suction Pressure" fill="#22d3ee" radius={[6, 6, 0, 0]} />
                                <Bar dataKey="discharge" name="Discharge Pressure" fill="#818cf8" radius={[6, 6, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div
                    className="glass-card p-5 border border-slate-700/50 relative"
                    onMouseEnter={() => setHoveredGraph('thermal')}
                    onMouseLeave={() => setHoveredGraph(null)}
                >
                    <h2 className="text-lg font-semibold text-slate-100 mb-3">Thermal Delta Lens</h2>
                    {hoveredGraph === 'thermal' && (
                        <div className="absolute right-4 top-4 max-w-xs rounded-lg border border-amber-500/35 bg-slate-950/90 px-3 py-2 text-[11px] text-amber-100">
                            Tracks actual discharge temperature against ideal model values to reveal heat inefficiency early.
                        </div>
                    )}
                    <div className="h-56">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={thermalProfile} margin={{ top: 10, right: 15, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                                <XAxis dataKey="stage" stroke="#94a3b8" tick={{ fontSize: 12 }} />
                                <YAxis stroke="#94a3b8" tick={{ fontSize: 12 }} />
                                <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }} />
                                <ReferenceLine y={350} stroke="#f97316" strokeDasharray="4 4" />
                                <Legend wrapperStyle={{ fontSize: 12 }} formatter={legendLabel} />
                                <Line type="monotone" dataKey="actual" name="Actual Temperature" stroke="#f59e0b" strokeWidth={2.5} dot={{ r: 3 }} />
                                <Line type="monotone" dataKey="ideal" name="Ideal Temperature" stroke="#38bdf8" strokeWidth={2} dot={{ r: 2 }} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </section>

            <section className="mb-6">
                <h2 className="text-lg font-semibold text-slate-300 mb-4">Compression Stage Detail</h2>
                <div className="flex gap-3 overflow-x-auto pb-1 pr-1">
                    {stages.map((stage: any) => (
                        <div
                            key={stage.stage}
                            className="min-w-[260px] max-w-[300px] rounded-xl border border-slate-700/60 bg-slate-900/50 p-3"
                        >
                            <div className="flex items-center justify-between mb-2">
                                <div className="text-sm font-semibold text-slate-100">Stage {stage.stage}</div>
                                <div className="text-xs text-cyan-300">R {asNumber(stage.ratio).toFixed(2)}</div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="rounded bg-slate-800/60 p-2">
                                    <div className="text-slate-500">Suc P</div>
                                    <div className="text-slate-100 font-semibold">{asNumber(stage.suction_press).toFixed(1)} PSIG</div>
                                </div>
                                <div className="rounded bg-slate-800/60 p-2">
                                    <div className="text-slate-500">Dis P</div>
                                    <div className="text-slate-100 font-semibold">{asNumber(stage.discharge_press).toFixed(1)} PSIG</div>
                                </div>
                                <div className="rounded bg-slate-800/60 p-2">
                                    <div className="text-slate-500">Suc T</div>
                                    <div className="text-slate-100 font-semibold">{asNumber(stage.suction_temp).toFixed(1)} °F</div>
                                </div>
                                <div className="rounded bg-slate-800/60 p-2">
                                    <div className="text-slate-500">Dis T</div>
                                    <div className="text-slate-100 font-semibold">{asNumber(stage.discharge_temp).toFixed(1)} °F</div>
                                </div>
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                                <div className="rounded bg-slate-800/50 p-2">
                                    <div className="text-slate-500">Isen Eff</div>
                                    <div className="text-emerald-300 font-semibold">{asNumber(stage.isentropic_eff).toFixed(1)}%</div>
                                </div>
                                <div className="rounded bg-slate-800/50 p-2">
                                    <div className="text-slate-500">Vol Eff</div>
                                    <div className="text-cyan-300 font-semibold">{asNumber(stage.volumetric_eff).toFixed(1)}%</div>
                                </div>
                            </div>
                        </div>
                    ))}
                    {!stages.length && <div className="text-slate-400 px-2 py-4">No stage data available</div>}
                </div>
            </section>

            <section className="grid grid-cols-1 xl:grid-cols-[1.35fr_1fr] gap-5">
                <div
                    className="glass-card p-5 border border-slate-700/50 relative"
                    onMouseEnter={() => setHoveredGraph('control')}
                    onMouseLeave={() => setHoveredGraph(null)}
                >
                    <h2 className="text-lg font-semibold text-slate-100 mb-3">Control Envelope</h2>
                    {hoveredGraph === 'control' && (
                        <div className="absolute right-4 top-4 max-w-xs rounded-lg border border-emerald-500/35 bg-slate-950/90 px-3 py-2 text-[11px] text-emerald-100">
                            Shows live valve and speed command percentages against target control bands for action validation.
                        </div>
                    )}
                    <div className="h-56">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={controlProfile} layout="vertical" margin={{ top: 8, right: 20, left: 20, bottom: 8 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                                <XAxis type="number" domain={[0, 100]} stroke="#94a3b8" tick={{ fontSize: 12 }} />
                                <YAxis type="category" dataKey="axis" stroke="#94a3b8" tick={{ fontSize: 12 }} />
                                <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }} />
                                <ReferenceLine x={65} stroke="#94a3b8" strokeDasharray="4 4" />
                                <Legend wrapperStyle={{ fontSize: 12 }} formatter={legendLabel} />
                                <Bar dataKey="value" name="Actual Value" fill="#22c55e" radius={[0, 6, 6, 0]} />
                                <Bar dataKey="target" name="Target Value" fill="#64748b" radius={[0, 6, 6, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="glass-card p-5 border border-slate-700/50">
                    <h2 className="text-lg font-semibold text-slate-100 mb-4">System Status</h2>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 p-3 text-center">
                            <span className="text-xs text-slate-400">Exhaust Spread</span>
                            <div className={`text-xl font-bold ${asNumber(liveData.exhaust_spread) > 75 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                {asNumber(liveData.exhaust_spread).toFixed(1)}°F
                            </div>
                        </div>
                        <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 p-3 text-center">
                            <span className="text-xs text-slate-400">Suction Valve</span>
                            <div className="text-xl font-bold text-cyan-400">{asNumber(liveData.suction_valve_pct).toFixed(1)}%</div>
                        </div>
                        <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 p-3 text-center">
                            <span className="text-xs text-slate-400">Speed Control</span>
                            <div className="text-xl font-bold text-emerald-400">{asNumber(liveData.speed_control_pct).toFixed(1)}%</div>
                        </div>
                        <div className="rounded-lg border border-slate-700/60 bg-slate-900/60 p-3 text-center">
                            <span className="text-xs text-slate-400">Recycle Valve</span>
                            <div className="text-xl font-bold text-amber-400">{asNumber(liveData.recycle_valve_pct).toFixed(1)}%</div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}
