import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Bar,
    BarChart,
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis
} from 'recharts';
import {
    fetchPerformanceDegradation,
    fetchPerformanceEfficiency,
    fetchPerformancePower,
    fetchPerformanceSummary
} from '../lib/api';
import { useUnit } from '../contexts/UnitContext';

type TrendPoint = { time: string; value: number };

function shortTime(ts: string): string {
    if (!ts) return '';
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function asNum(v: any, d = 0): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
}

export function PerformancePage() {
    const { unitId, units, setUnitId, activeUnit } = useUnit();
    const navigate = useNavigate();
    const [summary, setSummary] = useState<any>(null);
    const [eff, setEff] = useState<any>(null);
    const [power, setPower] = useState<any>(null);
    const [degrade, setDegrade] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let mounted = true;
        const load = async () => {
            try {
                const [s, e, p, d] = await Promise.all([
                    fetchPerformanceSummary(unitId),
                    fetchPerformanceEfficiency(unitId, { start: '-24h', aggregate: '5m' }),
                    fetchPerformancePower(unitId, { start: '-24h', aggregate: '5m' }),
                    fetchPerformanceDegradation(unitId, { start: '-7d', aggregate: '30m' })
                ]);
                if (!mounted) return;
                setSummary(s);
                setEff(e);
                setPower(p);
                setDegrade(d);
                setError(null);
            } catch (e: any) {
                if (!mounted) return;
                setError(e?.message || 'Failed to load performance data');
            } finally {
                if (mounted) setLoading(false);
            }
        };

        load();
        const timer = setInterval(load, 12000);
        return () => {
            mounted = false;
            clearInterval(timer);
        };
    }, [unitId]);

    const efficiencySeries = useMemo(() => {
        const isen: TrendPoint[] = eff?.series?.isentropic_eff_pct || [];
        const vol: TrendPoint[] = eff?.series?.volumetric_eff_pct || [];
        const m = new Map<string, any>();
        for (const p of isen) {
            m.set(p.time, { t: shortTime(p.time), isen: asNum(p.value), vol: null });
        }
        for (const p of vol) {
            const row = m.get(p.time) || { t: shortTime(p.time), isen: null, vol: null };
            row.vol = asNum(p.value);
            m.set(p.time, row);
        }
        return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0])).map((x) => x[1]).slice(-60);
    }, [eff]);

    const powerSeries = useMemo(() => {
        const bhp: TrendPoint[] = power?.series?.total_bhp || [];
        const rpm: TrendPoint[] = power?.series?.engine_rpm || [];
        const m = new Map<string, any>();
        for (const p of bhp) {
            m.set(p.time, { t: shortTime(p.time), bhp: asNum(p.value), rpm: null });
        }
        for (const p of rpm) {
            const row = m.get(p.time) || { t: shortTime(p.time), bhp: null, rpm: null };
            row.rpm = asNum(p.value);
            m.set(p.time, row);
        }
        return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0])).map((x) => x[1]).slice(-60);
    }, [power]);

    const distribution = useMemo(() => ([
        { name: 'Compression', value: asNum(power?.distribution?.compression_work_hp) },
        { name: 'Mechanical Loss', value: asNum(power?.distribution?.mechanical_loss_hp) },
        { name: 'Auxiliary', value: asNum(power?.distribution?.auxiliary_hp) }
    ]), [power]);

    const onSelectUnit = (nextUnitId: string) => {
        setUnitId(nextUnitId);
        navigate(`/packages/${nextUnitId}/performance`);
    };

    if (loading && !summary) {
        return <div className="p-6 text-slate-300">Loading performance analytics...</div>;
    }
    if (error && !summary) {
        return <div className="p-6 text-rose-300">{error}</div>;
    }

    const k = summary?.kpis || {};
    const degradation = degrade?.indicators || {};

    return (
        <div className="min-h-screen p-6 pb-8">
            <header className="mb-6 rounded-2xl border border-slate-700/60 bg-gradient-to-r from-slate-900 via-slate-900 to-emerald-950/40 p-6">
                <h1 className="text-3xl font-bold text-white">Performance & Analytics</h1>
                <p className="text-slate-300 mt-1">
                    Package <span className="font-semibold text-white">{activeUnit?.name || unitId}</span> ({unitId}) thermodynamic efficiency, power behavior, and degradation trend intelligence.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                    {units.map((unit, index) => (
                        <button
                            key={unit.unit_id}
                            type="button"
                            onClick={() => onSelectUnit(unit.unit_id)}
                            className={`px-3 py-1.5 rounded-lg text-xs border ${
                                unitId === unit.unit_id
                                    ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                                    : 'bg-slate-800/50 border-slate-700/60 text-slate-300 hover:border-slate-500/60'
                            }`}
                        >
                            Package {index + 1}: {unit.name}
                        </button>
                    ))}
                </div>
            </header>

            <section className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <div className="glass-card p-4 border border-slate-700/50">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Total BHP</div>
                    <div className="text-2xl font-semibold text-cyan-300 mt-1">{asNum(k.total_bhp).toFixed(1)}</div>
                </div>
                <div className="glass-card p-4 border border-slate-700/50">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Engine Load</div>
                    <div className="text-2xl font-semibold text-emerald-300 mt-1">{asNum(k.engine_load_pct).toFixed(1)}%</div>
                </div>
                <div className="glass-card p-4 border border-slate-700/50">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Avg Isentropic</div>
                    <div className="text-2xl font-semibold text-violet-300 mt-1">{asNum(k.avg_isentropic_eff_pct).toFixed(1)}%</div>
                </div>
                <div className="glass-card p-4 border border-slate-700/50">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Avg Volumetric</div>
                    <div className="text-2xl font-semibold text-amber-300 mt-1">{asNum(k.avg_volumetric_eff_pct).toFixed(1)}%</div>
                </div>
            </section>

            <section className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-6">
                <div className="glass-card p-5 border border-slate-700/50 relative group">
                    <h2 className="text-lg font-semibold text-slate-100 mb-3">Efficiency Trend (24h)</h2>
                    <div className="absolute right-4 top-4 hidden group-hover:block rounded border border-cyan-500/35 bg-slate-950/90 px-3 py-1.5 text-[11px] text-cyan-100">
                        Stage efficiencies are aggregated over time. Persistent decline indicates valve/ring or cooling issues.
                    </div>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={efficiencySeries}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                                <XAxis dataKey="t" stroke="#94a3b8" tick={{ fontSize: 12 }} />
                                <YAxis stroke="#94a3b8" tick={{ fontSize: 12 }} />
                                <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }} />
                                <Legend wrapperStyle={{ fontSize: 12 }} />
                                <Line type="monotone" dataKey="isen" name="Isentropic %" stroke="#a78bfa" strokeWidth={2.2} dot={false} />
                                <Line type="monotone" dataKey="vol" name="Volumetric %" stroke="#22d3ee" strokeWidth={2.2} dot={false} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="glass-card p-5 border border-slate-700/50 relative group">
                    <h2 className="text-lg font-semibold text-slate-100 mb-3">Power Trace (24h)</h2>
                    <div className="absolute right-4 top-4 hidden group-hover:block rounded border border-emerald-500/35 bg-slate-950/90 px-3 py-1.5 text-[11px] text-emerald-100">
                        BHP and RPM together reveal load transfer and drive stability under varying gas conditions.
                    </div>
                    <div className="h-64">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={powerSeries}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                                <XAxis dataKey="t" stroke="#94a3b8" tick={{ fontSize: 12 }} />
                                <YAxis yAxisId="left" stroke="#94a3b8" tick={{ fontSize: 12 }} />
                                <YAxis yAxisId="right" orientation="right" stroke="#94a3b8" tick={{ fontSize: 12 }} />
                                <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }} />
                                <Legend wrapperStyle={{ fontSize: 12 }} />
                                <Line yAxisId="left" type="monotone" dataKey="bhp" name="Total BHP" stroke="#34d399" strokeWidth={2.2} dot={false} />
                                <Line yAxisId="right" type="monotone" dataKey="rpm" name="Engine RPM" stroke="#f59e0b" strokeWidth={2.2} dot={false} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </section>

            <section className="grid grid-cols-1 xl:grid-cols-[1.2fr_1fr] gap-5">
                <div className="glass-card p-5 border border-slate-700/50 relative group">
                    <h2 className="text-lg font-semibold text-slate-100 mb-3">Power Distribution</h2>
                    <div className="absolute right-4 top-4 hidden group-hover:block rounded border border-violet-500/35 bg-slate-950/90 px-3 py-1.5 text-[11px] text-violet-100">
                        Splits shaft power into useful compression work and estimated losses.
                    </div>
                    <div className="h-60">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={distribution}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                                <XAxis dataKey="name" stroke="#94a3b8" tick={{ fontSize: 12 }} />
                                <YAxis stroke="#94a3b8" tick={{ fontSize: 12 }} />
                                <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 8 }} />
                                <Legend wrapperStyle={{ fontSize: 12 }} />
                                <Bar dataKey="value" name="HP" fill="#818cf8" radius={[6, 6, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                <div className="glass-card p-5 border border-slate-700/50">
                    <h2 className="text-lg font-semibold text-slate-100 mb-3">Degradation Indicators</h2>
                    <div className="space-y-3">
                        <div className="rounded-lg border border-slate-700/60 bg-slate-900/50 p-3">
                            <div className="text-xs text-slate-500 uppercase">Isentropic Efficiency</div>
                            <div className="text-slate-200 mt-1">
                                Current: <span className="font-semibold text-violet-300">{asNum(degradation?.isentropic_eff?.current_pct).toFixed(2)}%</span>
                            </div>
                            <div className="text-sm text-slate-300">
                                Drift: {asNum(degradation?.isentropic_eff?.slope_pct_per_day).toFixed(3)} %/day
                            </div>
                            <div className="text-xs text-slate-400">
                                Status: {degradation?.isentropic_eff?.status || 'stable'}
                            </div>
                        </div>
                        <div className="rounded-lg border border-slate-700/60 bg-slate-900/50 p-3">
                            <div className="text-xs text-slate-500 uppercase">Volumetric Efficiency</div>
                            <div className="text-slate-200 mt-1">
                                Current: <span className="font-semibold text-cyan-300">{asNum(degradation?.volumetric_eff?.current_pct).toFixed(2)}%</span>
                            </div>
                            <div className="text-sm text-slate-300">
                                Drift: {asNum(degradation?.volumetric_eff?.slope_pct_per_day).toFixed(3)} %/day
                            </div>
                            <div className="text-xs text-slate-400">
                                Status: {degradation?.volumetric_eff?.status || 'stable'}
                            </div>
                        </div>
                        <div className="rounded-lg border border-slate-700/60 bg-slate-900/50 p-3">
                            <div className="text-xs text-slate-500 uppercase">Thermal & Cooler</div>
                            <div className="text-sm text-slate-300 mt-1">
                                Thermal Delta: <span className="text-amber-300 font-semibold">{asNum(k.thermal_delta_f).toFixed(1)} °F</span>
                            </div>
                            <div className="text-sm text-slate-300">
                                Cooler Approach: <span className="text-emerald-300 font-semibold">{asNum(k.cooler_approach_f).toFixed(1)} °F</span>
                            </div>
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}
