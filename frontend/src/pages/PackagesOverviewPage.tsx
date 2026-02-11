import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Area, AreaChart, ResponsiveContainer, Tooltip } from 'recharts';
import { createUnit, deleteUnit, fetchLiveData, fetchUnitSummary } from '../lib/api';
import { useUnit } from '../contexts/UnitContext';

type PackageTelemetry = {
    engine_state_label?: string;
    engine_rpm?: number;
    engine_oil_press?: number;
    engine_oil_temp?: number;
    jacket_water_temp?: number;
    comp_oil_press?: number;
    comp_oil_temp?: number;
    overall_ratio?: number;
    total_bhp?: number;
    active_alarms?: number;
    shutdown_active?: boolean;
    timestamp?: string;
};

type TrendPoint = {
    t: number;
    rpm: number;
    bhp: number;
};

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function computeHealthScore(data: PackageTelemetry): number {
    let score = 100;

    const alarms = Number(data.active_alarms ?? 0);
    score -= Math.min(35, alarms * 10);
    if (data.shutdown_active) score -= 20;

    const eop = Number(data.engine_oil_press ?? 0);
    if (eop < 35) score -= 18;
    else if (eop < 45) score -= 8;

    const eot = Number(data.engine_oil_temp ?? 0);
    if (eot > 225) score -= 16;
    else if (eot > 205) score -= 8;

    const jwt = Number(data.jacket_water_temp ?? 0);
    if (jwt > 205) score -= 14;
    else if (jwt > 190) score -= 6;

    const state = (data.engine_state_label || 'UNKNOWN').toUpperCase();
    if (state === 'UNKNOWN' || state === 'FAULT') score -= 22;
    if (state === 'STOPPED') score -= 8;

    if (data.timestamp) {
        const age = (Date.now() - new Date(data.timestamp).getTime()) / 1000;
        if (age > 20) score -= 15;
        else if (age > 8) score -= 7;
    } else {
        score -= 18;
    }

    return clamp(Math.round(score), 0, 100);
}

function healthTone(score: number): { ring: string; text: string; chip: string; label: string } {
    if (score >= 85) return { ring: '#10b981', text: 'text-emerald-300', chip: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30', label: 'Healthy' };
    if (score >= 65) return { ring: '#f59e0b', text: 'text-amber-300', chip: 'bg-amber-500/15 text-amber-300 border-amber-400/30', label: 'Watch' };
    return { ring: '#ef4444', text: 'text-rose-300', chip: 'bg-rose-500/15 text-rose-300 border-rose-400/30', label: 'Critical' };
}

export function PackagesOverviewPage() {
    const navigate = useNavigate();
    const { units, setUnitId, refreshUnits, loading, pollIntervalMs } = useUnit();
    const [telemetry, setTelemetry] = useState<Record<string, PackageTelemetry>>({});
    const [history, setHistory] = useState<Record<string, TrendPoint[]>>({});
    const [showAddPackage, setShowAddPackage] = useState(false);
    const [showDeleteId, setShowDeleteId] = useState<string | null>(null);
    const [hoveredPulseFor, setHoveredPulseFor] = useState<string | null>(null);
    const [deleteBusy, setDeleteBusy] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);
    const [addBusy, setAddBusy] = useState(false);
    const [addError, setAddError] = useState<string | null>(null);
    const [form, setForm] = useState({
        unit_id: '',
        name: '',
        stage_count: 3
    });

    const nextDefaultId = useMemo(() => {
        let n = 1;
        const ids = new Set(units.map((u) => u.unit_id));
        while (ids.has(`GCS-${String(n).padStart(3, '0')}`)) n += 1;
        return `GCS-${String(n).padStart(3, '0')}`;
    }, [units]);

    useEffect(() => {
        if (!form.unit_id) {
            setForm((prev) => ({ ...prev, unit_id: nextDefaultId, name: `Compressor Package ${nextDefaultId}` }));
        }
    }, [nextDefaultId]);

    useEffect(() => {
        let mounted = true;
        const load = async () => {
            const now = Date.now();
            const entries = await Promise.all(
                units.map(async (u) => {
                    try {
                        const [summary, live] = await Promise.all([
                            fetchUnitSummary(u.unit_id).catch(() => null),
                            fetchLiveData(u.unit_id).catch(() => null)
                        ]);
                        if (!summary && !live) {
                            return [u.unit_id, null, null] as const;
                        }
                        return [u.unit_id, {
                            engine_state_label: live?.engine_state_label,
                            engine_rpm: summary?.engine_rpm ?? live?.engine_rpm,
                            engine_oil_press: live?.engine_oil_press,
                            engine_oil_temp: live?.engine_oil_temp,
                            jacket_water_temp: live?.jacket_water_temp,
                            comp_oil_press: live?.comp_oil_press,
                            comp_oil_temp: live?.comp_oil_temp,
                            overall_ratio: live?.overall_ratio,
                            total_bhp: live?.total_bhp,
                            active_alarms: summary?.active_alarms ?? 0,
                            shutdown_active: summary?.shutdown_active ?? false,
                            timestamp: live?.timestamp ?? summary?.timestamp
                        }, {
                            t: now,
                            rpm: Number(summary?.engine_rpm ?? live?.engine_rpm ?? 0),
                            bhp: Number(live?.total_bhp ?? 0)
                        }] as const;
                    } catch {
                        return [u.unit_id, null, null] as const;
                    }
                })
            );

            if (!mounted) return;
            setTelemetry((prev) => {
                const next = { ...prev };
                for (const [id, t] of entries) {
                    if (!t) continue;
                    next[id] = { ...(next[id] || {}), ...t };
                }
                return next;
            });
            setHistory((prev) => {
                const next = { ...prev };
                for (const [id, , point] of entries) {
                    if (!point) continue;
                    const series = next[id] ? [...next[id], point] : [point];
                    next[id] = series.slice(-28);
                }
                return next;
            });
        };

        if (units.length > 0) load();
        const timer = setInterval(load, pollIntervalMs);
        return () => {
            mounted = false;
            clearInterval(timer);
        };
    }, [units, pollIntervalMs]);

    const fleetSummary = useMemo(() => {
        const items = units.map((u) => telemetry[u.unit_id] || {});
        const health = items.map(computeHealthScore);
        const running = items.filter((t) => (t.engine_state_label || '').toUpperCase() === 'RUNNING').length;
        const alarms = items.reduce((sum, t) => sum + Number(t.active_alarms ?? 0), 0);
        const avgHealth = health.length ? Math.round(health.reduce((a, b) => a + b, 0) / health.length) : 0;
        const avgRpm = items.length ? Math.round(items.reduce((sum, t) => sum + Number(t.engine_rpm ?? 0), 0) / items.length) : 0;
        return { running, alarms, avgHealth, avgRpm };
    }, [units, telemetry]);

    const openPackage = (unitId: string) => {
        setUnitId(unitId);
        navigate(`/packages/${unitId}/dashboard`);
    };

    const submitAddPackage = async () => {
        if (!form.unit_id || !form.name) {
            setAddError('Package ID and name are required.');
            return;
        }

        setAddBusy(true);
        setAddError(null);
        try {
            const newId = form.unit_id.trim().toUpperCase();
            await createUnit({
                unit_id: newId,
                name: form.name.trim(),
                stage_count: Number(form.stage_count) || 3
            });
            await refreshUnits();
            setShowAddPackage(false);
            setUnitId(newId);
            navigate(`/packages/${newId}/dashboard`);
        } catch (e: any) {
            setAddError(e?.message || 'Failed to create package');
        } finally {
            setAddBusy(false);
        }
    };

    const submitDeletePackage = async () => {
        if (!showDeleteId) return;
        if (units.length <= 1) {
            setDeleteError('At least one package must remain active.');
            return;
        }
        setDeleteBusy(true);
        setDeleteError(null);
        try {
            await deleteUnit(showDeleteId);
            await refreshUnits();
            setShowDeleteId(null);
            navigate('/');
        } catch (e: any) {
            setDeleteError(e?.message || 'Failed to delete package');
        } finally {
            setDeleteBusy(false);
        }
    };

    return (
        <div className="p-6 md:p-8">
            <div className="max-w-7xl">
                <header className="mb-8 relative overflow-hidden rounded-2xl border border-slate-700/60 bg-gradient-to-r from-slate-900 via-slate-900 to-cyan-950/40 p-6">
                    <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-cyan-500/15 blur-3xl" />
                    <div className="pointer-events-none absolute -left-14 -bottom-16 h-44 w-44 rounded-full bg-emerald-500/10 blur-3xl" />
                    <div className="relative">
                        <h1 className="text-3xl font-bold text-white">Fleet Health Command View</h1>
                        <p className="text-slate-300 mt-2">Instant operational posture across all compressor packages. Click any tile for detailed diagnostics.</p>
                    </div>
                </header>

                <section className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-7">
                    <div className="glass-card p-4 border border-slate-700/60">
                        <div className="text-xs uppercase tracking-wide text-slate-400">Total Packages</div>
                        <div className="text-3xl font-semibold text-white mt-2">{units.length}</div>
                    </div>
                    <div className="glass-card p-4 border border-slate-700/60">
                        <div className="text-xs uppercase tracking-wide text-slate-400">Running</div>
                        <div className="text-3xl font-semibold text-emerald-300 mt-2">{fleetSummary.running}</div>
                    </div>
                    <div className="glass-card p-4 border border-slate-700/60">
                        <div className="text-xs uppercase tracking-wide text-slate-400">Fleet Health</div>
                        <div className="text-3xl font-semibold text-cyan-300 mt-2">{fleetSummary.avgHealth}%</div>
                    </div>
                    <div className="glass-card p-4 border border-slate-700/60">
                        <div className="text-xs uppercase tracking-wide text-slate-400">Active Alarms</div>
                        <div className={`text-3xl font-semibold mt-2 ${fleetSummary.alarms > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>{fleetSummary.alarms}</div>
                    </div>
                    <div className="glass-card p-4 border border-slate-700/60">
                        <div className="text-xs uppercase tracking-wide text-slate-400">Avg RPM</div>
                        <div className="text-3xl font-semibold text-violet-300 mt-2">{fleetSummary.avgRpm}</div>
                    </div>
                </section>

                <div className="flex items-center justify-between mb-6">
                    <div className="text-sm text-slate-400">Live package snapshots</div>
                    <button
                        type="button"
                        onClick={() => {
                            setForm({ unit_id: nextDefaultId, name: `Compressor Package ${nextDefaultId}`, stage_count: 3 });
                            setAddError(null);
                            setShowAddPackage(true);
                        }}
                        className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white text-sm font-medium"
                    >
                        + Add Package
                    </button>
                </div>

                {loading ? (
                    <div className="text-slate-400">Loading packages...</div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                        {units.map((unit, index) => {
                            const t = telemetry[unit.unit_id] || {};
                            const score = computeHealthScore(t);
                            const tone = healthTone(score);
                            const running = (t.engine_state_label || '').toUpperCase() === 'RUNNING';
                            const staleSeconds = t.timestamp ? Math.max(0, (Date.now() - new Date(t.timestamp).getTime()) / 1000) : null;
                            const fresh = staleSeconds !== null && staleSeconds <= 8;
                            const trend = (history[unit.unit_id] || []).map((p) => ({ x: p.t, rpm: p.rpm, bhp: p.bhp }));

                            return (
                                <button
                                    key={unit.unit_id}
                                    type="button"
                                    onClick={() => openPackage(unit.unit_id)}
                                    className="text-left p-5 rounded-2xl border border-slate-700/60 bg-gradient-to-br from-slate-900/95 to-slate-900/60 hover:border-cyan-500/50 transition-all overflow-hidden relative"
                                >
                                    <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-cyan-500/10 blur-2xl" />
                                    <div className="relative">
                                        <div className="flex items-start justify-between gap-4">
                                            <div>
                                                <div className="text-xs font-semibold text-slate-400">Package {index + 1}</div>
                                                <div className="text-xl font-semibold text-white mt-1">{unit.unit_id}</div>
                                                <div className="text-sm text-slate-400">{unit.name}</div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <div className={`px-2.5 py-1 rounded-md border text-[11px] ${tone.chip}`}>{tone.label}</div>
                                                <div
                                                    className="relative h-14 w-14 rounded-full"
                                                    style={{ background: `conic-gradient(${tone.ring} ${score * 3.6}deg, rgba(51,65,85,0.65) 0deg)` }}
                                                >
                                                    <div className="absolute inset-[6px] rounded-full bg-slate-950/95 flex items-center justify-center">
                                                        <span className={`text-xs font-semibold ${tone.text}`}>{score}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-4 gap-3 mt-4">
                                            <div>
                                                <div className="text-[11px] text-slate-500">State</div>
                                                <div className={`text-sm font-medium ${running ? 'text-emerald-300' : 'text-amber-300'}`}>{t.engine_state_label || 'UNKNOWN'}</div>
                                            </div>
                                            <div>
                                                <div className="text-[11px] text-slate-500">RPM</div>
                                                <div className="text-slate-200 font-medium">{Number(t.engine_rpm ?? 0).toFixed(0)}</div>
                                            </div>
                                            <div>
                                                <div className="text-[11px] text-slate-500">BHP</div>
                                                <div className="text-slate-200 font-medium">{Number(t.total_bhp ?? 0).toFixed(0)}</div>
                                            </div>
                                            <div>
                                                <div className="text-[11px] text-slate-500">Ratio</div>
                                                <div className="text-slate-200 font-medium">{Number(t.overall_ratio ?? 0).toFixed(2)}</div>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-4 gap-3 mt-3 text-sm">
                                            <div>
                                                <div className="text-[11px] text-slate-500">Eng Oil P</div>
                                                <div className="text-slate-200">{Number(t.engine_oil_press ?? 0).toFixed(1)}</div>
                                            </div>
                                            <div>
                                                <div className="text-[11px] text-slate-500">Comp Oil P</div>
                                                <div className="text-slate-200">{Number(t.comp_oil_press ?? 0).toFixed(1)}</div>
                                            </div>
                                            <div>
                                                <div className="text-[11px] text-slate-500">JW Temp</div>
                                                <div className="text-slate-200">{Number(t.jacket_water_temp ?? 0).toFixed(1)}°F</div>
                                            </div>
                                            <div>
                                                <div className="text-[11px] text-slate-500">Alarms</div>
                                                <div className={`${(t.active_alarms || 0) > 0 ? 'text-amber-300' : 'text-emerald-300'} font-medium`}>{t.active_alarms ?? 0}</div>
                                            </div>
                                        </div>

                                        <div
                                            className="mt-4 h-24 rounded-lg border border-slate-700/50 bg-slate-900/50 p-2 relative"
                                            onMouseEnter={() => setHoveredPulseFor(unit.unit_id)}
                                            onMouseLeave={() => setHoveredPulseFor(null)}
                                        >
                                            <div className="mb-1 flex items-center justify-between gap-2">
                                                <div className="text-[10px] uppercase tracking-wide text-slate-500">Operation Pulse</div>
                                                <div className="flex items-center gap-2 text-[10px] text-slate-300">
                                                    <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-cyan-400" />RPM</span>
                                                    <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-violet-400" />BHP</span>
                                                </div>
                                            </div>
                                            {hoveredPulseFor === unit.unit_id && (
                                                <div className="absolute right-2 top-6 z-10 max-w-[220px] rounded border border-cyan-500/35 bg-slate-950/90 px-2 py-1 text-[10px] text-cyan-100">
                                                    RPM and BHP trend together to expose load shift, drag, or transient instability.
                                                </div>
                                            )}
                                            <ResponsiveContainer width="100%" height="100%">
                                                <AreaChart data={trend}>
                                                    <defs>
                                                        <linearGradient id={`rpm_${unit.unit_id}`} x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.65} />
                                                            <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
                                                        </linearGradient>
                                                        <linearGradient id={`bhp_${unit.unit_id}`} x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="5%" stopColor="#a78bfa" stopOpacity={0.55} />
                                                            <stop offset="95%" stopColor="#a78bfa" stopOpacity={0} />
                                                        </linearGradient>
                                                    </defs>
                                                    <Tooltip
                                                        contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
                                                        labelStyle={{ color: '#94a3b8' }}
                                                    />
                                                    <Area type="monotone" dataKey="rpm" stroke="#22d3ee" strokeWidth={1.8} fill={`url(#rpm_${unit.unit_id})`} />
                                                    <Area type="monotone" dataKey="bhp" stroke="#a78bfa" strokeWidth={1.3} fill={`url(#bhp_${unit.unit_id})`} />
                                                </AreaChart>
                                            </ResponsiveContainer>
                                        </div>

                                        <div className="text-[11px] text-slate-500 mt-3">
                                            Last update: {t.timestamp ? new Date(t.timestamp).toLocaleTimeString() : 'N/A'}
                                            {staleSeconds !== null && (
                                                <span className={`ml-2 ${fresh ? 'text-emerald-400' : 'text-amber-400'}`}>
                                                    {fresh ? 'Fresh' : `Stale ${Math.round(staleSeconds)}s`}
                                                </span>
                                            )}
                                        </div>
                                        <div className="mt-3 flex justify-end">
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setDeleteError(null);
                                                    setShowDeleteId(unit.unit_id);
                                                }}
                                                className="px-2.5 py-1 rounded border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 text-xs"
                                            >
                                                Delete Package
                                            </button>
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {showAddPackage && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5">
                        <h2 className="text-lg font-semibold text-white mb-4">Add Package</h2>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Package ID</label>
                                <input
                                    value={form.unit_id}
                                    onChange={(e) => setForm((p) => ({ ...p, unit_id: e.target.value }))}
                                    className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-700 text-white"
                                    placeholder="GCS-004"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Package Name</label>
                                <input
                                    value={form.name}
                                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                                    className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-700 text-white"
                                    placeholder="Compressor Package GCS-004"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Stage Count</label>
                                <input
                                    type="number"
                                    min={1}
                                    max={8}
                                    value={form.stage_count}
                                    onChange={(e) => setForm((p) => ({ ...p, stage_count: parseInt(e.target.value, 10) || 3 }))}
                                    className="w-full px-3 py-2 rounded bg-slate-800 border border-slate-700 text-white"
                                />
                            </div>
                            {addError && <div className="text-sm text-red-400">{addError}</div>}
                        </div>

                        <div className="flex gap-2 mt-5">
                            <button
                                type="button"
                                onClick={() => setShowAddPackage(false)}
                                className="flex-1 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
                                disabled={addBusy}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={submitAddPackage}
                                className="flex-1 py-2 rounded bg-cyan-600 hover:bg-cyan-700 text-white"
                                disabled={addBusy}
                            >
                                {addBusy ? 'Creating...' : 'Create Package'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showDeleteId && (
                <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50">
                    <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5">
                        <h2 className="text-lg font-semibold text-white mb-2">Delete Package</h2>
                        <p className="text-sm text-slate-300">
                            This will deactivate and remove package <span className="font-semibold text-white">{showDeleteId}</span> from active workspace.
                        </p>
                        <p className="text-xs text-rose-300 mt-2">This action cannot be undone from UI.</p>
                        {deleteError && <div className="text-sm text-rose-300 mt-3">{deleteError}</div>}
                        <div className="flex gap-2 mt-5">
                            <button
                                type="button"
                                onClick={() => setShowDeleteId(null)}
                                className="flex-1 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-200"
                                disabled={deleteBusy}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={submitDeletePackage}
                                className="flex-1 py-2 rounded bg-rose-600 hover:bg-rose-700 text-white"
                                disabled={deleteBusy}
                            >
                                {deleteBusy ? 'Deleting...' : 'Delete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
