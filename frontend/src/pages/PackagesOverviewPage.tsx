import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createUnit, fetchLiveData, fetchUnitSummary } from '../lib/api';
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

export function PackagesOverviewPage() {
    const navigate = useNavigate();
    const { units, setUnitId, refreshUnits, loading } = useUnit();
    const [telemetry, setTelemetry] = useState<Record<string, PackageTelemetry>>({});
    const [showAddPackage, setShowAddPackage] = useState(false);
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
            const entries = await Promise.all(
                units.map(async (u) => {
                    try {
                        const [summary, live] = await Promise.all([
                            fetchUnitSummary(u.unit_id),
                            fetchLiveData(u.unit_id)
                        ]);
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
                            timestamp: live?.timestamp
                        }] as const;
                    } catch {
                        return [u.unit_id, {}] as const;
                    }
                })
            );

            if (!mounted) return;
            setTelemetry(Object.fromEntries(entries));
        };

        if (units.length > 0) load();
        const timer = setInterval(load, 3000);
        return () => {
            mounted = false;
            clearInterval(timer);
        };
    }, [units]);

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
            await createUnit({
                unit_id: form.unit_id.trim().toUpperCase(),
                name: form.name.trim(),
                stage_count: Number(form.stage_count) || 3
            });
            await refreshUnits();
            setShowAddPackage(false);
            setUnitId(form.unit_id.trim().toUpperCase());
            navigate(`/packages/${form.unit_id.trim().toUpperCase()}/dashboard`);
        } catch (e: any) {
            setAddError(e?.message || 'Failed to create package');
        } finally {
            setAddBusy(false);
        }
    };

    return (
        <div className="p-6 md:p-8">
            <div className="max-w-7xl">
                <header className="mb-8">
                    <h1 className="text-3xl font-bold text-white">Compressor Fleet Overview</h1>
                    <p className="text-slate-400 mt-2">Landing page for all packages. Select any package to open detailed views.</p>
                </header>

                <div className="flex items-center justify-between mb-6">
                    <div className="text-sm text-slate-400">Packages: {units.length}</div>
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
                            const running = (t.engine_state_label || '').toUpperCase() === 'RUNNING';
                            const staleSeconds = t.timestamp ? Math.max(0, (Date.now() - new Date(t.timestamp).getTime()) / 1000) : null;
                            const fresh = staleSeconds !== null && staleSeconds <= 8;
                            return (
                                <button
                                    key={unit.unit_id}
                                    type="button"
                                    onClick={() => openPackage(unit.unit_id)}
                                    className="text-left p-5 rounded-2xl border border-slate-700/60 bg-slate-900/60 hover:border-cyan-500/50 transition-all"
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="text-xs font-semibold text-slate-400">Package {index + 1}</div>
                                        <div className={`text-xs ${running ? 'text-emerald-400' : 'text-amber-400'}`}>
                                            {t.engine_state_label || 'UNKNOWN'}
                                        </div>
                                    </div>
                                    <div className="text-xl font-semibold text-white mt-1">{unit.unit_id}</div>
                                    <div className="text-sm text-slate-400">{unit.name}</div>

                                    <div className="grid grid-cols-4 gap-3 mt-4">
                                        <div>
                                            <div className="text-[11px] text-slate-500">Stages</div>
                                            <div className="text-slate-200 font-medium">{unit.stage_count}</div>
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

                                    <div className="grid grid-cols-3 gap-3 mt-3">
                                        <div>
                                            <div className="text-[11px] text-slate-500">Eng Oil P</div>
                                            <div className="text-slate-300 text-sm">{Number(t.engine_oil_press ?? 0).toFixed(1)}</div>
                                        </div>
                                        <div>
                                            <div className="text-[11px] text-slate-500">Comp Oil P</div>
                                            <div className="text-slate-300 text-sm">{Number(t.comp_oil_press ?? 0).toFixed(1)}</div>
                                        </div>
                                        <div>
                                            <div className="text-[11px] text-slate-500">JW Temp</div>
                                            <div className="text-slate-300 text-sm">{Number(t.jacket_water_temp ?? 0).toFixed(1)}°F</div>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-3 gap-3 mt-3">
                                        <div>
                                            <div className="text-[11px] text-slate-500">Eng Oil T</div>
                                            <div className="text-slate-300 text-sm">{Number(t.engine_oil_temp ?? 0).toFixed(1)}°F</div>
                                        </div>
                                        <div>
                                            <div className="text-[11px] text-slate-500">Comp Oil T</div>
                                            <div className="text-slate-300 text-sm">{Number(t.comp_oil_temp ?? 0).toFixed(1)}°F</div>
                                        </div>
                                        <div>
                                            <div className="text-[11px] text-slate-500">Alarms</div>
                                            <div className={`text-sm font-medium ${(t.active_alarms || 0) > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                                {t.active_alarms ?? 0}
                                                {t.shutdown_active ? ' (SD)' : ''}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="text-[11px] text-slate-500 mt-4">
                                        Last update: {t.timestamp ? new Date(t.timestamp).toLocaleTimeString() : 'N/A'}
                                        {staleSeconds !== null && (
                                            <span className={`ml-2 ${fresh ? 'text-emerald-400' : 'text-amber-400'}`}>
                                                {fresh ? 'Fresh' : `Stale ${Math.round(staleSeconds)}s`}
                                            </span>
                                        )}
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
                                    onChange={(e) => setForm((p) => ({ ...p, stage_count: parseInt(e.target.value) || 3 }))}
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
        </div>
    );
}
