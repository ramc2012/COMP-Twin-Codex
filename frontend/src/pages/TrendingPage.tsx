/**
 * TrendingPage - Historical data visualization from InfluxDB
 * Updated to use parameter-based trends API
 */
import { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useUnit } from '../contexts/UnitContext';

const API_BASE = '/api';

const PARAMETER_OPTIONS = [
    { value: 'engine_rpm', label: 'Engine RPM', color: '#14b8a6' },
    { value: 'engine_oil_pressure', label: 'Engine Oil Pressure', color: '#f97316' },
    { value: 'engine_oil_temp', label: 'Engine Oil Temp', color: '#dc2626' },
    { value: 'jacket_water_temp', label: 'Jacket Water Temp', color: '#0ea5e9' },
    { value: 'stg1_suction_pressure', label: 'Stage 1 Suction P', color: '#06b6d4' },
    { value: 'stg1_discharge_pressure', label: 'Stage 1 Discharge P', color: '#10b981' },
    { value: 'stg2_suction_pressure', label: 'Stage 2 Suction P', color: '#f59e0b' },
    { value: 'stg2_discharge_pressure', label: 'Stage 2 Discharge P', color: '#ef4444' },
    { value: 'stg3_suction_pressure', label: 'Stage 3 Suction P', color: '#8b5cf6' },
    { value: 'stg3_discharge_pressure', label: 'Stage 3 Discharge P', color: '#ec4899' },
    { value: 'overall_ratio', label: 'Overall Ratio', color: '#a855f7' },
    { value: 'total_bhp', label: 'Total BHP', color: '#22c55e' },
];

const TIME_RANGES = [
    { value: '-1h', label: '1 Hour' },
    { value: '-4h', label: '4 Hours' },
    { value: '-24h', label: '24 Hours' },
    { value: '-7d', label: '7 Days' },
    { value: '-30d', label: '30 Days' },
];

export function TrendingPage() {
    const { unitId } = useUnit();
    const [selectedParams, setSelectedParams] = useState<string[]>(['engine_rpm', 'stg1_discharge_pressure']);
    const [timeRange, setTimeRange] = useState('-1h');
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (selectedParams.length === 0) return;

        const loadData = async () => {
            setLoading(true);
            setError(null);

            try {
                // Use the new parameter-based trends API
                const params = new URLSearchParams({
                    parameters: selectedParams.join(','),
                    start: timeRange
                });

                const response = await fetch(`${API_BASE}/trends/${unitId}?${params}`);
                if (!response.ok) throw new Error('Failed to fetch trends');

                const result = await response.json();

                // Transform the response to chart-friendly format
                const chartData = transformTrendData(result.parameters, selectedParams);
                setData(chartData);
            } catch (e) {
                setError('Failed to load trend data. InfluxDB may not have data yet.');
                // Generate demo data for display
                setData(generateDemoData(selectedParams, timeRange));
            } finally {
                setLoading(false);
            }
        };

        loadData();
    }, [unitId, selectedParams, timeRange]);

    const toggleParam = (param: string) => {
        setSelectedParams(prev =>
            prev.includes(param) ? prev.filter(p => p !== param) : [...prev, param]
        );
    };

    return (
        <div className="min-h-screen p-6">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-white">📈 Trending & Analytics</h1>
                <p className="text-slate-400 mt-1">Historical data visualization for {unitId}</p>
            </div>

            {/* Controls */}
            <div className="glass-card p-4 mb-6">
                <div className="flex flex-wrap items-center gap-4">
                    <div>
                        <label className="text-slate-400 text-xs block mb-1">Time Range</label>
                        <div className="flex gap-1">
                            {TIME_RANGES.map(tr => (
                                <button key={tr.value} onClick={() => setTimeRange(tr.value)}
                                    className={`px-3 py-1.5 rounded text-sm ${timeRange === tr.value
                                        ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50'
                                        : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700/50'
                                        }`}>
                                    {tr.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="flex-1">
                        <label className="text-slate-400 text-xs block mb-1">Parameters</label>
                        <div className="flex flex-wrap gap-2">
                            {PARAMETER_OPTIONS.map(param => (
                                <button key={param.value} onClick={() => toggleParam(param.value)}
                                    className={`px-3 py-1.5 rounded text-xs flex items-center gap-2 ${selectedParams.includes(param.value)
                                        ? 'bg-slate-700/50 text-white border border-slate-600/50'
                                        : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700/50'
                                        }`}>
                                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: param.color }} />
                                    {param.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {error && (
                <div className="mb-4 p-3 bg-amber-500/20 border border-amber-500/50 rounded-lg text-amber-400 text-sm">
                    ⚠ {error}
                </div>
            )}

            {/* Chart */}
            <div className="glass-card p-6">
                <h2 className="text-lg font-semibold text-white mb-4">
                    {selectedParams.length > 0 ? 'Trend Chart' : 'Select parameters to display'}
                </h2>

                {loading ? (
                    <div className="h-80 flex items-center justify-center text-slate-400">
                        Loading trend data...
                    </div>
                ) : data.length > 0 ? (
                    <ResponsiveContainer width="100%" height={400}>
                        <LineChart data={data}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                            <XAxis
                                dataKey="time"
                                stroke="#64748b"
                                tick={{ fontSize: 11 }}
                                tickFormatter={(v) => new Date(v).toLocaleTimeString()}
                            />
                            <YAxis stroke="#64748b" tick={{ fontSize: 11 }} />
                            <Tooltip
                                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }}
                                labelFormatter={(v) => new Date(v).toLocaleString()}
                            />
                            <Legend />
                            {selectedParams.map(param => {
                                const opt = PARAMETER_OPTIONS.find(p => p.value === param);
                                return (
                                    <Line
                                        key={param}
                                        type="monotone"
                                        dataKey={param}
                                        stroke={opt?.color || '#06b6d4'}
                                        name={opt?.label || param}
                                        dot={false}
                                        strokeWidth={2}
                                    />
                                );
                            })}
                        </LineChart>
                    </ResponsiveContainer>
                ) : (
                    <div className="h-80 flex items-center justify-center text-slate-400">
                        No data available for the selected time range
                    </div>
                )}
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                <KPICard title="Avg Efficiency" value="87.3%" change="+2.1%" positive />
                <KPICard title="Uptime" value="99.2%" change="+0.3%" positive />
                <KPICard title="Total Alarms" value="12" change="-5" positive />
                <KPICard title="Avg Power" value="1,245 HP" change="+45 HP" />
            </div>
        </div>
    );
}

function KPICard({ title, value, change, positive = false }: { title: string; value: string; change?: string; positive?: boolean }) {
    return (
        <div className="glass-card p-4">
            <div className="text-slate-400 text-xs mb-1">{title}</div>
            <div className="text-2xl font-bold text-white">{value}</div>
            {change && (
                <div className={`text-xs mt-1 ${positive ? 'text-green-400' : 'text-slate-400'}`}>
                    {change} vs last period
                </div>
            )}
        </div>
    );
}

function transformTrendData(parameters: Record<string, any>, selectedParams: string[]): any[] {
    // Merge all parameter data into chart-friendly format
    const timeMap = new Map<string, any>();

    for (const param of selectedParams) {
        const paramData = parameters[param]?.data || [];
        for (const point of paramData) {
            const time = point.time;
            if (!timeMap.has(time)) {
                timeMap.set(time, { time });
            }
            timeMap.get(time)[param] = point.value;
        }
    }

    return Array.from(timeMap.values()).sort((a, b) =>
        new Date(a.time).getTime() - new Date(b.time).getTime()
    );
}

function generateDemoData(params: string[], range: string): any[] {
    const points = range === '-1h' ? 60 : range === '-4h' ? 48 : 24;
    const now = new Date();

    return Array(points).fill(null).map((_, i) => {
        const time = new Date(now.getTime() - (points - i) * 60000);
        const point: any = { time: time.toISOString() };

        params.forEach(p => {
            const base = p.includes('pressure') ? 100 + Math.random() * 50 :
                p.includes('rpm') ? 1000 + Math.random() * 100 :
                    p.includes('temp') ? 180 + Math.random() * 20 : 50;
            point[p] = Math.round(base * 10) / 10;
        });

        return point;
    });
}
