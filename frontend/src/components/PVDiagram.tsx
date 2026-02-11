/**
 * PVDiagram - Enhanced with Model vs Measured distinction and valve health
 */
import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { fetchPVDiagram } from '../lib/api';
import { useUnit } from '../contexts/UnitContext';

interface PVDiagramProps {
    unitId: string;
    stage?: number;
}

interface DeviationAnalysis {
    deviation_f: number;
    deviation_pct: number;
    health_status: string;
    health_color: string;
    assessment: string;
}

interface ValveHealth {
    status: string;
    indicator: string;
    temperature_deviation_f: number;
    note: string;
}

export function PVDiagram({ unitId, stage = 1 }: PVDiagramProps) {
    const { pollIntervalMs } = useUnit();
    const [data, setData] = useState<{ volume: number; pressure: number }[]>([]);
    const [loading, setLoading] = useState(true);
    const [source, setSource] = useState<string>('MODEL');
    const [suctionP, setSuctionP] = useState(0);
    const [dischargeP, setDischargeP] = useState(0);
    const [deviation, setDeviation] = useState<DeviationAnalysis | null>(null);
    const [valveHealth, setValveHealth] = useState<ValveHealth | null>(null);
    const [operating, setOperating] = useState<any>(null);

    useEffect(() => {
        const loadData = async () => {
            try {
                const result = await fetchPVDiagram(unitId, stage);

                // Handle enhanced API response
                const volumes = result.model_data?.volumes || result.volumes;
                const pressures = result.model_data?.pressures || result.pressures;

                const points = volumes.map((v: number, i: number) => ({
                    volume: v,
                    pressure: pressures[i]
                }));

                setData(points);
                setSource(result.source || 'MODEL');
                setSuctionP(result.operating_conditions?.suction_pressure_psia || result.suction_pressure_psia);
                setDischargeP(result.operating_conditions?.discharge_pressure_psia || result.discharge_pressure_psia);
                setDeviation(result.deviation_analysis || null);
                setValveHealth(result.valve_health_proxy || null);
                setOperating(result.operating_conditions || null);
                setLoading(false);
            } catch (e) {
                console.error('Failed to load PV diagram:', e);
                setLoading(false);
            }
        };

        loadData();
        const interval = setInterval(loadData, pollIntervalMs);
        return () => clearInterval(interval);
    }, [unitId, stage, pollIntervalMs]);

    if (loading) {
        return (
            <div className="glass-card p-6 h-80 flex items-center justify-center">
                <span className="text-slate-400">Loading PV diagram...</span>
            </div>
        );
    }

    const healthColor = valveHealth?.status === 'GOOD' ? 'text-green-400'
        : valveHealth?.status === 'MARGINAL' ? 'text-yellow-400'
            : 'text-red-400';

    return (
        <div className="glass-card p-6">
            {/* Header with source indicator */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <h3 className="text-lg font-semibold text-white">PV Diagram - Stage {stage}</h3>
                    <span className={`px-2 py-1 text-xs rounded-full ${source === 'MEASURED' ? 'bg-green-500/20 text-green-400' : 'bg-purple-500/20 text-purple-400'
                        }`}>
                        {source === 'MEASURED' ? '📡 MEASURED' : '📐 MODEL'}
                    </span>
                </div>
                <div className="flex gap-4 text-sm">
                    <span className="text-cyan-400">Ps: {suctionP.toFixed(1)} PSIA</span>
                    <span className="text-blue-400">Pd: {dischargeP.toFixed(1)} PSIA</span>
                </div>
            </div>

            {/* Chart */}
            <ResponsiveContainer width="100%" height={280}>
                <LineChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis
                        dataKey="volume"
                        stroke="#94a3b8"
                        label={{ value: 'Volume (cu.in)', position: 'bottom', fill: '#94a3b8' }}
                        tickFormatter={(v) => v.toFixed(0)}
                    />
                    <YAxis
                        stroke="#94a3b8"
                        label={{ value: 'Pressure (PSIA)', angle: -90, position: 'insideLeft', fill: '#94a3b8' }}
                        tickFormatter={(v) => v.toFixed(0)}
                    />
                    <Tooltip
                        contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
                        formatter={(value: any) => [value.toFixed(2), '']}
                        labelFormatter={(label) => `Volume: ${label.toFixed(2)} cu.in`}
                    />
                    <ReferenceLine y={suctionP} stroke="#22d3ee" strokeDasharray="5 5" label={{ value: 'Ps', fill: '#22d3ee' }} />
                    <ReferenceLine y={dischargeP} stroke="#3b82f6" strokeDasharray="5 5" label={{ value: 'Pd', fill: '#3b82f6' }} />
                    <Line type="monotone" dataKey="pressure" stroke="#8b5cf6" strokeWidth={2} dot={false} animationDuration={500} name="Model" />
                </LineChart>
            </ResponsiveContainer>

            {/* Deviation Analysis & Valve Health */}
            {(deviation || valveHealth) && (
                <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                    {/* Temperature Comparison */}
                    {operating && (
                        <div className="bg-slate-800/50 rounded-lg p-3">
                            <div className="text-slate-400 mb-2">Temperature Analysis</div>
                            <div className="flex justify-between">
                                <span className="text-slate-300">T_discharge (Actual):</span>
                                <span className="text-white font-mono">{operating.discharge_temp_actual_f?.toFixed(1)}°F</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-300">T_discharge (Ideal):</span>
                                <span className="text-slate-400 font-mono">{operating.discharge_temp_ideal_f?.toFixed(1)}°F</span>
                            </div>
                            {deviation && (
                                <div className="flex justify-between mt-1 pt-1 border-t border-slate-700">
                                    <span className="text-slate-300">Deviation:</span>
                                    <span className={`font-mono ${deviation.deviation_f > 5 ? 'text-red-400' : deviation.deviation_f < -5 ? 'text-yellow-400' : 'text-green-400'}`}>
                                        {deviation.deviation_f > 0 ? '+' : ''}{deviation.deviation_f?.toFixed(1)}°F ({deviation.deviation_pct?.toFixed(1)}%)
                                    </span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Valve Health Proxy */}
                    {valveHealth && (
                        <div className="bg-slate-800/50 rounded-lg p-3">
                            <div className="text-slate-400 mb-2">Valve Health Proxy</div>
                            <div className="flex items-center gap-2 mb-2">
                                <span className="text-2xl">{valveHealth.indicator}</span>
                                <span className={`font-semibold ${healthColor}`}>{valveHealth.status}</span>
                            </div>
                            <div className="text-xs text-slate-500">{deviation?.assessment}</div>
                        </div>
                    )}
                </div>
            )}

            {/* Footer */}
            <div className="mt-3 text-xs text-slate-500 text-center">
                {source === 'MODEL'
                    ? `📐 Synthesized ideal polytropic curve (n=1.25) • Updates every ${(pollIntervalMs / 1000).toFixed(0)}s`
                    : '📡 Live data from high-speed pressure transducers'}
            </div>
        </div>
    );
}
