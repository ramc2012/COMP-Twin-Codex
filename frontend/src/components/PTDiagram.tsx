/**
 * PTDiagram - Pressure-Temperature path through compression stages
 */
import { useEffect, useState } from 'react';
import { Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ComposedChart } from 'recharts';
import { fetchPTDiagram } from '../lib/api';
import { useUnit } from '../contexts/UnitContext';

interface PTDiagramProps {
  unitId: string;
}

interface Point {
  label: string;
  pressure_psig: number;
  temperature_f: number;
  type: string;
}

export function PTDiagram({ unitId }: PTDiagramProps) {
  const { pollIntervalMs } = useUnit();
  const [path, setPath] = useState<Point[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const result = await fetchPTDiagram(unitId);
        setPath(result.path);
        setLoading(false);
      } catch (e) {
        console.error('Failed to load PT diagram:', e);
        setLoading(false);
      }
    };

    loadData();
    const interval = setInterval(loadData, pollIntervalMs);
    return () => clearInterval(interval);
  }, [unitId, pollIntervalMs]);

  if (loading) {
    return (
      <div className="glass-card p-6 h-80 flex items-center justify-center">
        <span className="text-slate-400">Loading PT diagram...</span>
      </div>
    );
  }

  const getPointColor = (type: string) => {
    switch (type) {
      case 'suction': return '#22d3ee';
      case 'discharge': return '#ef4444';
      case 'cooler': return '#22c55e';
      default: return '#8b5cf6';
    }
  };

  return (
    <div className="glass-card p-6">
      <h3 className="text-lg font-semibold text-white mb-4">PT Diagram - Compression Path</h3>
      
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={path} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis 
            dataKey="temperature_f" 
            stroke="#94a3b8" 
            label={{ value: 'Temperature (°F)', position: 'bottom', fill: '#94a3b8' }}
            domain={['auto', 'auto']}
          />
          <YAxis 
            dataKey="pressure_psig"
            stroke="#94a3b8" 
            label={{ value: 'Pressure (PSIG)', angle: -90, position: 'insideLeft', fill: '#94a3b8' }}
            domain={['auto', 'auto']}
          />
          <Tooltip 
            contentStyle={{ 
              backgroundColor: '#1e293b', 
              border: '1px solid #334155',
              borderRadius: '8px'
            }}
            formatter={(value: any, name: any) => [
              `${value.toFixed(1)} ${name === 'pressure_psig' ? 'PSIG' : '°F'}`,
              name === 'pressure_psig' ? 'Pressure' : 'Temperature'
            ]}
            labelFormatter={(_, payload) => payload?.[0]?.payload?.label || ''}
          />
          <Line 
            type="monotone" 
            dataKey="pressure_psig" 
            stroke="#8b5cf6" 
            strokeWidth={2}
            dot={(props: any) => {
              const { cx, cy, payload } = props;
              return (
                <circle 
                  key={`${cx}-${cy}`}
                  cx={cx} 
                  cy={cy} 
                  r={8} 
                  fill={getPointColor(payload.type)}
                  stroke="#1e293b"
                  strokeWidth={2}
                />
              );
            }}
            animationDuration={500}
          />
        </ComposedChart>
      </ResponsiveContainer>
      
      {/* Legend */}
      <div className="mt-4 flex justify-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-cyan-400"></div>
          <span className="text-slate-400">Suction</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500"></div>
          <span className="text-slate-400">Discharge</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-green-500"></div>
          <span className="text-slate-400">After Cooler</span>
        </div>
      </div>
    </div>
  );
}
