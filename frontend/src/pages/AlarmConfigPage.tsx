/**
 * AlarmConfigPage - Configure alarm setpoints
 */
import { useState, useEffect } from 'react';
import { useUnit } from '../contexts/UnitContext';

const API_BASE = '/api';

interface AlarmSetpoint {
    id: number;
    parameter: string;
    ll_value: number | null;
    l_value: number | null;
    h_value: number | null;
    hh_value: number | null;
    delay_seconds: number;
    is_shutdown: boolean;
    enabled: boolean;
    description: string | null;
}

const COMMON_PARAMETERS = [
    'engine_rpm', 'engine_oil_press', 'engine_oil_temp', 'jacket_water_temp',
    'comp_oil_press', 'comp_oil_temp', 'stg1_discharge_temp', 'stg2_discharge_temp',
    'stg3_discharge_temp', 'stg1_suction_press', 'stg2_suction_press', 'stg3_suction_press',
    'stg1_discharge_press', 'stg2_discharge_press', 'stg3_discharge_press',
    'frame_vibration', 'crosshead_vibration'
];

export function AlarmConfigPage() {
    const { unitId } = useUnit();
    const [setpoints, setSetpoints] = useState<AlarmSetpoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showAddForm, setShowAddForm] = useState(false);
    const [newSetpoint, setNewSetpoint] = useState({
        parameter: '',
        ll_value: '',
        l_value: '',
        h_value: '',
        hh_value: '',
        delay_seconds: 5,
        is_shutdown: false,
        enabled: true,
        description: ''
    });

    useEffect(() => {
        loadSetpoints();
    }, [unitId]);

    const loadSetpoints = async () => {
        try {
            setLoading(true);
            const res = await fetch(`${API_BASE}/alarms/setpoints?unit_id=${unitId}`);
            if (!res.ok) throw new Error('Failed to load setpoints');
            const data = await res.json();
            setSetpoints(data.setpoints || []);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async () => {
        try {
            const token = localStorage.getItem('auth_token');
            const res = await fetch(`${API_BASE}/alarms/setpoints?unit_id=${unitId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    parameter: newSetpoint.parameter,
                    ll_value: newSetpoint.ll_value ? parseFloat(newSetpoint.ll_value) : null,
                    l_value: newSetpoint.l_value ? parseFloat(newSetpoint.l_value) : null,
                    h_value: newSetpoint.h_value ? parseFloat(newSetpoint.h_value) : null,
                    hh_value: newSetpoint.hh_value ? parseFloat(newSetpoint.hh_value) : null,
                    delay_seconds: newSetpoint.delay_seconds,
                    is_shutdown: newSetpoint.is_shutdown,
                    enabled: newSetpoint.enabled,
                    description: newSetpoint.description || null
                })
            });
            if (!res.ok) throw new Error('Failed to create setpoint');
            setShowAddForm(false);
            setNewSetpoint({
                parameter: '', ll_value: '', l_value: '', h_value: '', hh_value: '',
                delay_seconds: 5, is_shutdown: false, enabled: true, description: ''
            });
            loadSetpoints();
        } catch (e: any) {
            setError(e.message);
        }
    };

    const handleDelete = async (id: number) => {
        if (!confirm('Delete this alarm setpoint?')) return;
        try {
            const token = localStorage.getItem('auth_token');
            const res = await fetch(`${API_BASE}/alarms/setpoints/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) throw new Error('Failed to delete setpoint');
            loadSetpoints();
        } catch (e: any) {
            setError(e.message);
        }
    };

    const toggleEnabled = async (sp: AlarmSetpoint) => {
        try {
            const token = localStorage.getItem('auth_token');
            const res = await fetch(`${API_BASE}/alarms/setpoints/${sp.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ enabled: !sp.enabled })
            });
            if (!res.ok) throw new Error('Failed to update setpoint');
            loadSetpoints();
        } catch (e: any) {
            setError(e.message);
        }
    };

    return (
        <div className="min-h-screen p-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-white">⚙️ Alarm Configuration</h1>
                    <p className="text-slate-400 mt-1">Configure alarm setpoints for {unitId}</p>
                </div>
                <button
                    onClick={() => setShowAddForm(true)}
                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg flex items-center gap-2"
                >
                    + Add Setpoint
                </button>
            </div>

            {error && (
                <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400">
                    {error}
                </div>
            )}

            {/* Add Form */}
            {showAddForm && (
                <div className="glass-card p-6 mb-6">
                    <h3 className="text-lg font-semibold text-white mb-4">New Alarm Setpoint</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="col-span-2">
                            <label className="text-slate-400 text-xs">Parameter</label>
                            <select
                                value={newSetpoint.parameter}
                                onChange={e => setNewSetpoint({ ...newSetpoint, parameter: e.target.value })}
                                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white"
                            >
                                <option value="">Select parameter...</option>
                                {COMMON_PARAMETERS.map(p => (
                                    <option key={p} value={p}>{p}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="text-slate-400 text-xs">LL (Low-Low)</label>
                            <input
                                type="number"
                                value={newSetpoint.ll_value}
                                onChange={e => setNewSetpoint({ ...newSetpoint, ll_value: e.target.value })}
                                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white"
                                placeholder="Optional"
                            />
                        </div>
                        <div>
                            <label className="text-slate-400 text-xs">L (Low)</label>
                            <input
                                type="number"
                                value={newSetpoint.l_value}
                                onChange={e => setNewSetpoint({ ...newSetpoint, l_value: e.target.value })}
                                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white"
                                placeholder="Optional"
                            />
                        </div>
                        <div>
                            <label className="text-slate-400 text-xs">H (High)</label>
                            <input
                                type="number"
                                value={newSetpoint.h_value}
                                onChange={e => setNewSetpoint({ ...newSetpoint, h_value: e.target.value })}
                                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white"
                                placeholder="Optional"
                            />
                        </div>
                        <div>
                            <label className="text-slate-400 text-xs">HH (High-High)</label>
                            <input
                                type="number"
                                value={newSetpoint.hh_value}
                                onChange={e => setNewSetpoint({ ...newSetpoint, hh_value: e.target.value })}
                                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white"
                                placeholder="Optional"
                            />
                        </div>
                        <div>
                            <label className="text-slate-400 text-xs">Delay (sec)</label>
                            <input
                                type="number"
                                value={newSetpoint.delay_seconds}
                                onChange={e => setNewSetpoint({ ...newSetpoint, delay_seconds: parseInt(e.target.value) })}
                                className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white"
                            />
                        </div>
                        <div className="flex items-center gap-4">
                            <label className="flex items-center gap-2 text-slate-400">
                                <input
                                    type="checkbox"
                                    checked={newSetpoint.is_shutdown}
                                    onChange={e => setNewSetpoint({ ...newSetpoint, is_shutdown: e.target.checked })}
                                    className="rounded"
                                />
                                Shutdown
                            </label>
                        </div>
                    </div>
                    <div className="flex gap-2 mt-4">
                        <button onClick={handleCreate} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded">
                            Create
                        </button>
                        <button onClick={() => setShowAddForm(false)} className="px-4 py-2 bg-slate-600 hover:bg-slate-700 text-white rounded">
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Setpoints Table */}
            <div className="glass-card overflow-hidden">
                {loading ? (
                    <div className="p-8 text-center text-slate-400">Loading setpoints...</div>
                ) : setpoints.length === 0 ? (
                    <div className="p-8 text-center text-slate-400">No alarm setpoints configured</div>
                ) : (
                    <table className="w-full">
                        <thead className="bg-slate-800/50">
                            <tr>
                                <th className="px-4 py-3 text-left text-xs text-slate-400">Parameter</th>
                                <th className="px-4 py-3 text-center text-xs text-slate-400">LL</th>
                                <th className="px-4 py-3 text-center text-xs text-slate-400">L</th>
                                <th className="px-4 py-3 text-center text-xs text-slate-400">H</th>
                                <th className="px-4 py-3 text-center text-xs text-slate-400">HH</th>
                                <th className="px-4 py-3 text-center text-xs text-slate-400">Delay</th>
                                <th className="px-4 py-3 text-center text-xs text-slate-400">Shutdown</th>
                                <th className="px-4 py-3 text-center text-xs text-slate-400">Enabled</th>
                                <th className="px-4 py-3 text-center text-xs text-slate-400">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {setpoints.map(sp => (
                                <tr key={sp.id} className="border-t border-slate-700/50 hover:bg-slate-800/30">
                                    <td className="px-4 py-3 text-white font-mono text-sm">{sp.parameter}</td>
                                    <td className="px-4 py-3 text-center text-blue-400">{sp.ll_value ?? '-'}</td>
                                    <td className="px-4 py-3 text-center text-cyan-400">{sp.l_value ?? '-'}</td>
                                    <td className="px-4 py-3 text-center text-amber-400">{sp.h_value ?? '-'}</td>
                                    <td className="px-4 py-3 text-center text-red-400">{sp.hh_value ?? '-'}</td>
                                    <td className="px-4 py-3 text-center text-slate-400">{sp.delay_seconds}s</td>
                                    <td className="px-4 py-3 text-center">
                                        {sp.is_shutdown ? <span className="text-red-400">🔴</span> : <span className="text-slate-500">-</span>}
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <button onClick={() => toggleEnabled(sp)} className={`px-2 py-1 rounded text-xs ${sp.enabled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-600/50 text-slate-400'}`}>
                                            {sp.enabled ? 'ON' : 'OFF'}
                                        </button>
                                    </td>
                                    <td className="px-4 py-3 text-center">
                                        <button onClick={() => handleDelete(sp.id)} className="text-red-400 hover:text-red-300 text-sm">
                                            Delete
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
