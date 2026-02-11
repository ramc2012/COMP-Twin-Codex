/**
 * AlarmsPage - Real-time alarms with backend integration
 * Updated: History tab now fetches from backend, Config tab uses backend setpoints
 */
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useUnit } from '../contexts/UnitContext';
import { 
    fetchActiveAlarms, 
    fetchAlarmsSummary, 
    acknowledgeAlarm, 
    fetchAlarmHistory,
    fetchAlarmSetpoints,
    acknowledgeAlarmEvent,
    clearAlarmEvent,
    type AlarmActive,
    type AlarmEvent 
} from '../lib/api';

const TIME_RANGES = [
    { label: '1h', hours: 1 },
    { label: '6h', hours: 6 },
    { label: '24h', hours: 24 },
    { label: '7d', hours: 168 },
];

export function AlarmsPage() {
    const { unitId, pollIntervalMs } = useUnit();
    const [activeAlarms, setActiveAlarms] = useState<AlarmActive[]>([]);
    const [summary, setSummary] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<'active' | 'history' | 'config'>('active');
    
    // History state
    const [historyEvents, setHistoryEvents] = useState<AlarmEvent[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyHours, setHistoryHours] = useState(24);
    
    // Config state
    const [setpoints, setSetpoints] = useState<any[]>([]);
    const [setpointsLoading, setSetpointsLoading] = useState(false);

    const loadAlarms = async () => {
        try {
            const [alarmsData, summaryData] = await Promise.all([
                fetchActiveAlarms(unitId),
                fetchAlarmsSummary(unitId)
            ]);
            setActiveAlarms(alarmsData.alarms || []);
            setSummary(summaryData);
        } catch (e) {
            console.error('Failed to load alarms:', e);
            setActiveAlarms([]);
            setSummary({ total_active: 0, by_level: { LL: 0, L: 0, H: 0, HH: 0 }, shutdown_active: false });
        } finally {
            setLoading(false);
        }
    };

    const loadHistory = async () => {
        try {
            setHistoryLoading(true);
            const data = await fetchAlarmHistory(unitId, { hours: historyHours, limit: 100 });
            setHistoryEvents(data.events || []);
        } catch (e) {
            console.error('Failed to load alarm history:', e);
            setHistoryEvents([]);
        } finally {
            setHistoryLoading(false);
        }
    };

    const loadSetpoints = async () => {
        try {
            setSetpointsLoading(true);
            const data = await fetchAlarmSetpoints(unitId);
            setSetpoints(data.setpoints || []);
        } catch (e) {
            console.error('Failed to load setpoints:', e);
            setSetpoints([]);
        } finally {
            setSetpointsLoading(false);
        }
    };

    useEffect(() => {
        loadAlarms();
        const interval = setInterval(loadAlarms, pollIntervalMs);
        return () => clearInterval(interval);
    }, [unitId, pollIntervalMs]);

    useEffect(() => {
        if (tab === 'history') {
            loadHistory();
        } else if (tab === 'config') {
            loadSetpoints();
        }
    }, [tab, unitId, historyHours]);

    const handleAcknowledge = async (alarmId: string) => {
        try {
            await acknowledgeAlarm(unitId, alarmId);
            await loadAlarms();
        } catch (e) {
            console.error('Failed to acknowledge:', e);
        }
    };

    const handleAcknowledgeEvent = async (eventId: number) => {
        try {
            await acknowledgeAlarmEvent(unitId, eventId);
            await loadHistory();
        } catch (e) {
            console.error('Failed to acknowledge event:', e);
        }
    };

    const handleClearEvent = async (eventId: number) => {
        try {
            await clearAlarmEvent(unitId, eventId);
            await loadHistory();
        } catch (e) {
            console.error('Failed to clear event:', e);
        }
    };

    const getLevelColor = (level: string) => {
        switch (level) {
            case 'HH': return 'bg-red-500/20 text-red-400 border-red-500/50';
            case 'H': return 'bg-orange-500/20 text-orange-400 border-orange-500/50';
            case 'L': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50';
            case 'LL': return 'bg-blue-500/20 text-blue-400 border-blue-500/50';
            default: return 'bg-slate-500/20 text-slate-400 border-slate-500/50';
        }
    };

    const getLevelBadgeColor = (level: string) => {
        switch (level) {
            case 'HH': return 'bg-red-500 text-white';
            case 'H': return 'bg-orange-500 text-white';
            case 'L': return 'bg-yellow-500 text-black';
            case 'LL': return 'bg-blue-500 text-white';
            default: return 'bg-slate-500 text-white';
        }
    };

    return (
        <div className="min-h-screen p-6">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-white">🚨 Alarms & Safety</h1>
                <p className="text-slate-400 mt-1">Monitor and manage alarms for {unitId}</p>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                <SummaryCard label="Total Active" value={summary?.active_count || summary?.total_active || 0} color="cyan" />
                <SummaryCard label="HH (Critical)" value={summary?.by_level?.HH || 0} color="red" />
                <SummaryCard label="H (High)" value={summary?.by_level?.H || 0} color="orange" />
                <SummaryCard label="L (Low)" value={summary?.by_level?.L || 0} color="yellow" />
                <SummaryCard label="LL (Low-Low)" value={summary?.by_level?.LL || 0} color="blue" />
            </div>

            {summary?.shutdown_active && (
                <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg flex items-center gap-3">
                    <span className="text-2xl">⛔</span>
                    <div>
                        <div className="text-red-400 font-semibold">SHUTDOWN ACTIVE</div>
                        <div className="text-red-300 text-sm">Critical safety condition detected</div>
                    </div>
                </div>
            )}

            {/* Tabs */}
            <div className="flex gap-2 mb-6">
                {(['active', 'history', 'config'] as const).map(t => (
                    <button key={t} onClick={() => setTab(t)}
                        className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === t ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50' : 'bg-slate-800/50 text-slate-400'
                            }`}>
                        {t === 'active' ? '🔴 Active' : t === 'history' ? '📋 History' : '⚙️ Configuration'}
                    </button>
                ))}
            </div>

            {/* Active Alarms Tab */}
            {tab === 'active' && (
                <div className="glass-card p-6">
                    <h2 className="text-lg font-semibold text-white mb-4">Active Alarms</h2>
                    {loading ? (
                        <div className="text-slate-400 py-8 text-center">Loading alarms...</div>
                    ) : activeAlarms.length === 0 ? (
                        <div className="text-green-400 py-8 text-center flex flex-col items-center gap-2">
                            <span className="text-4xl">✓</span>
                            <span>No active alarms</span>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {activeAlarms.map(alarm => (
                                <div key={alarm.id} className={`p-4 rounded-lg border ${getLevelColor(alarm.level)} flex items-center justify-between`}>
                                    <div className="flex items-center gap-4">
                                        <span className={`px-2 py-1 rounded text-xs font-bold ${getLevelColor(alarm.level)}`}>
                                            {alarm.level}
                                        </span>
                                        <div>
                                            <div className="font-medium">{alarm.parameter}</div>
                                            <div className="text-sm opacity-75">
                                                Value: {alarm.value.toFixed(1)} | Setpoint: {alarm.setpoint.toFixed(1)}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <span className="text-xs opacity-75">
                                            {new Date(alarm.timestamp).toLocaleTimeString()}
                                        </span>
                                        {!alarm.acknowledged && (
                                            <button onClick={() => handleAcknowledge(alarm.id)}
                                                className="px-3 py-1 bg-slate-700/50 hover:bg-slate-600/50 rounded text-xs">
                                                Acknowledge
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* History Tab */}
            {tab === 'history' && (
                <div className="glass-card p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold text-white">Alarm History</h2>
                        <div className="flex gap-2">
                            {TIME_RANGES.map(range => (
                                <button
                                    key={range.hours}
                                    onClick={() => setHistoryHours(range.hours)}
                                    className={`px-3 py-1 rounded text-xs ${
                                        historyHours === range.hours
                                            ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50'
                                            : 'bg-slate-700/50 text-slate-400 hover:bg-slate-600/50'
                                    }`}
                                >
                                    {range.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    
                    {historyLoading ? (
                        <div className="text-slate-400 py-8 text-center">Loading history...</div>
                    ) : historyEvents.length === 0 ? (
                        <div className="text-slate-400 py-8 text-center">
                            No alarm events in the last {historyHours} hours
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-slate-700/50 text-slate-400 text-left">
                                        <th className="py-2 px-3">Time</th>
                                        <th className="py-2 px-3">Parameter</th>
                                        <th className="py-2 px-3">Level</th>
                                        <th className="py-2 px-3">Value</th>
                                        <th className="py-2 px-3">Setpoint</th>
                                        <th className="py-2 px-3">Status</th>
                                        <th className="py-2 px-3">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="text-slate-300">
                                    {historyEvents.map(event => (
                                        <tr key={event.id} className="border-b border-slate-700/30 hover:bg-slate-800/30">
                                            <td className="py-2 px-3 text-xs">
                                                {new Date(event.triggered_at).toLocaleString()}
                                            </td>
                                            <td className="py-2 px-3 font-mono">{event.parameter}</td>
                                            <td className="py-2 px-3">
                                                <span className={`px-2 py-0.5 rounded text-xs font-bold ${getLevelBadgeColor(event.level)}`}>
                                                    {event.level}
                                                </span>
                                                {event.is_shutdown && <span className="ml-1 text-red-400">⛔</span>}
                                            </td>
                                            <td className="py-2 px-3">{event.value.toFixed(1)}</td>
                                            <td className="py-2 px-3">{event.setpoint.toFixed(1)}</td>
                                            <td className="py-2 px-3">
                                                {event.cleared_at ? (
                                                    <span className="text-green-400 text-xs">Cleared</span>
                                                ) : event.acknowledged_at ? (
                                                    <span className="text-yellow-400 text-xs">Acknowledged</span>
                                                ) : (
                                                    <span className="text-red-400 text-xs">Active</span>
                                                )}
                                            </td>
                                            <td className="py-2 px-3">
                                                <div className="flex gap-2">
                                                    {!event.acknowledged_at && !event.cleared_at && (
                                                        <button
                                                            onClick={() => handleAcknowledgeEvent(event.id)}
                                                            className="px-2 py-1 bg-slate-700/50 hover:bg-slate-600/50 rounded text-xs"
                                                        >
                                                            Ack
                                                        </button>
                                                    )}
                                                    {!event.cleared_at && (
                                                        <button
                                                            onClick={() => handleClearEvent(event.id)}
                                                            className="px-2 py-1 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-400 rounded text-xs"
                                                        >
                                                            Clear
                                                        </button>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* Config Tab */}
            {tab === 'config' && (
                <div className="glass-card p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold text-white">Alarm Setpoints</h2>
                        <Link
                            to={`/packages/${unitId}/config/alarms`}
                            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg text-sm flex items-center gap-2"
                        >
                            ⚙️ Full Configuration
                        </Link>
                    </div>
                    
                    {setpointsLoading ? (
                        <div className="text-slate-400 py-8 text-center">Loading setpoints...</div>
                    ) : setpoints.length === 0 ? (
                        <div className="text-slate-400 py-8 text-center">
                            No alarm setpoints configured.{' '}
                            <Link to={`/packages/${unitId}/config/alarms`} className="text-cyan-400 hover:underline">
                                Configure now →
                            </Link>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-slate-700/50 text-slate-400 text-left">
                                        <th className="py-2 px-3">Parameter</th>
                                        <th className="py-2 px-3 text-center">LL</th>
                                        <th className="py-2 px-3 text-center">L</th>
                                        <th className="py-2 px-3 text-center">H</th>
                                        <th className="py-2 px-3 text-center">HH</th>
                                        <th className="py-2 px-3 text-center">Delay</th>
                                        <th className="py-2 px-3 text-center">Shutdown</th>
                                        <th className="py-2 px-3 text-center">Enabled</th>
                                    </tr>
                                </thead>
                                <tbody className="text-slate-300">
                                    {setpoints.map(sp => (
                                        <tr key={sp.id} className="border-b border-slate-700/30">
                                            <td className="py-2 px-3 font-mono">{sp.parameter}</td>
                                            <td className="py-2 px-3 text-center text-blue-400">{sp.ll_value ?? '-'}</td>
                                            <td className="py-2 px-3 text-center text-cyan-400">{sp.l_value ?? '-'}</td>
                                            <td className="py-2 px-3 text-center text-amber-400">{sp.h_value ?? '-'}</td>
                                            <td className="py-2 px-3 text-center text-red-400">{sp.hh_value ?? '-'}</td>
                                            <td className="py-2 px-3 text-center">{sp.delay_seconds}s</td>
                                            <td className="py-2 px-3 text-center">
                                                {sp.is_shutdown ? <span className="text-red-400">⚠️ Yes</span> : 'No'}
                                            </td>
                                            <td className="py-2 px-3 text-center">
                                                <span className={sp.enabled ? 'text-emerald-400' : 'text-slate-500'}>
                                                    {sp.enabled ? '✓' : '✗'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
    const colors: Record<string, string> = {
        cyan: 'text-cyan-400',
        red: 'text-red-400',
        orange: 'text-orange-400',
        yellow: 'text-yellow-400',
        blue: 'text-blue-400'
    };
    return (
        <div className="glass-card p-4">
            <div className="text-slate-400 text-xs">{label}</div>
            <div className={`text-2xl font-bold ${colors[color]}`}>{value}</div>
        </div>
    );
}
