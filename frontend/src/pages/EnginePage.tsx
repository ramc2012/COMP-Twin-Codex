/**
 * EnginePage - Detailed engine view with exhaust and bearing visualization
 */
import { useEffect } from 'react';
import { useDataStore } from '../store/useDataStore';
import { fetchLiveData } from '../lib/api';
import { MetricCard } from '../components/MetricCard';

export function EnginePage() {
  const { liveData, setLiveData } = useDataStore();

  useEffect(() => {
    const fetchData = async () => {
      const data = await fetchLiveData('GCS-001');
      setLiveData(data as any);
    };
    fetchData();
    const interval = setInterval(fetchData, 1000);
    return () => clearInterval(interval);
  }, []);

  if (!liveData) {
    return (
      <div className="min-h-screen p-6 flex items-center justify-center">
        <span className="text-slate-400">Loading engine data...</span>
      </div>
    );
  }

  const avgTemp = liveData.exhaust_avg;

  return (
    <div className="min-h-screen p-6">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-white">Engine Detail</h1>
        <p className="text-slate-400 mt-1">Unit: {liveData.unit_id}</p>
      </header>

      {/* Engine Vitals */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-slate-300 mb-4">Engine Vitals</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard title="Engine RPM" value={liveData.engine_rpm} unit="RPM" icon="⚙️" />
          <MetricCard title="Engine State" value={liveData.engine_state_label} icon="🔄" />
          <MetricCard title="Hour Meter" value={liveData.hour_meter} unit="hrs" icon="⏱️" />
          <MetricCard 
            title="Engine Oil Pressure" 
            value={liveData.engine_oil_press} 
            unit="PSIG" 
            icon="🛢️"
            status={liveData.engine_oil_press < 40 ? 'warning' : 'normal'}
          />
          <MetricCard 
            title="Engine Oil Temp" 
            value={liveData.engine_oil_temp} 
            unit="°F" 
            icon="🌡️"
            status={liveData.engine_oil_temp > 200 ? 'warning' : 'normal'}
          />
          <MetricCard title="Jacket Water Temp" value={liveData.jacket_water_temp} unit="°F" icon="💧" />
        </div>
      </section>

      {/* Exhaust Temperature Visualization */}
      <section className="glass-card p-6 mb-8">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold text-white">Exhaust Temperatures by Cylinder</h3>
          <div className="flex gap-6">
            <div>
              <span className="text-xs text-slate-400">Spread</span>
              <div className={`text-2xl font-bold ${liveData.exhaust_spread > 75 ? 'text-amber-400' : 'text-emerald-400'}`}>
                {liveData.exhaust_spread.toFixed(1)}°F
              </div>
            </div>
            <div>
              <span className="text-xs text-slate-400">Average</span>
              <div className="text-2xl font-bold text-slate-300">{avgTemp.toFixed(1)}°F</div>
            </div>
          </div>
        </div>

        {/* Cylinder visualization - two banks */}
        <div className="grid grid-cols-2 gap-8">
          {/* Left Bank */}
          <div>
            <h4 className="text-sm text-slate-400 mb-3 text-center">Left Bank</h4>
            <div className="grid grid-cols-6 gap-2">
              {[1, 2, 3, 4, 5, 6].map((cyl) => {
                const temp = liveData.exhaust_temps[`cyl${cyl}_left`] || 0;
                const deviation = temp - avgTemp;
                const barHeight = Math.min(100, Math.max(20, ((temp - 800) / 300) * 100));
                return (
                  <div key={`left-${cyl}`} className="text-center">
                    <div className="h-32 flex items-end justify-center bg-slate-800/50 rounded-lg p-1">
                      <div 
                        className={`w-full rounded transition-all ${
                          temp > 1000 ? 'bg-red-500' : temp > 975 ? 'bg-amber-500' : 'bg-emerald-500'
                        }`}
                        style={{ height: `${barHeight}%` }}
                      ></div>
                    </div>
                    <div className="mt-2 text-xs text-slate-500">Cyl {cyl}L</div>
                    <div className={`text-sm font-semibold ${
                      temp > 1000 ? 'text-red-400' : temp > 975 ? 'text-amber-400' : 'text-emerald-400'
                    }`}>{temp.toFixed(0)}°</div>
                    <div className={`text-xs ${deviation > 25 ? 'text-red-400' : deviation > 15 ? 'text-amber-400' : 'text-slate-500'}`}>
                      {deviation > 0 ? '+' : ''}{deviation.toFixed(0)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Bank */}
          <div>
            <h4 className="text-sm text-slate-400 mb-3 text-center">Right Bank</h4>
            <div className="grid grid-cols-6 gap-2">
              {[1, 2, 3, 4, 5, 6].map((cyl) => {
                const temp = liveData.exhaust_temps[`cyl${cyl}_right`] || 0;
                const deviation = temp - avgTemp;
                const barHeight = Math.min(100, Math.max(20, ((temp - 800) / 300) * 100));
                return (
                  <div key={`right-${cyl}`} className="text-center">
                    <div className="h-32 flex items-end justify-center bg-slate-800/50 rounded-lg p-1">
                      <div 
                        className={`w-full rounded transition-all ${
                          temp > 1000 ? 'bg-red-500' : temp > 975 ? 'bg-amber-500' : 'bg-emerald-500'
                        }`}
                        style={{ height: `${barHeight}%` }}
                      ></div>
                    </div>
                    <div className="mt-2 text-xs text-slate-500">Cyl {cyl}R</div>
                    <div className={`text-sm font-semibold ${
                      temp > 1000 ? 'text-red-400' : temp > 975 ? 'text-amber-400' : 'text-emerald-400'
                    }`}>{temp.toFixed(0)}°</div>
                    <div className={`text-xs ${deviation > 25 ? 'text-red-400' : deviation > 15 ? 'text-amber-400' : 'text-slate-500'}`}>
                      {deviation > 0 ? '+' : ''}{deviation.toFixed(0)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Turbo Temps */}
        <div className="grid grid-cols-4 gap-4 mt-6 pt-6 border-t border-slate-700/50">
          <div className="text-center p-3 rounded-lg bg-slate-800/30">
            <div className="text-xs text-slate-400">Pre-Turbo Left</div>
            <div className="text-xl font-semibold text-orange-400">{liveData.pre_turbo_left.toFixed(0)}°F</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-slate-800/30">
            <div className="text-xs text-slate-400">Pre-Turbo Right</div>
            <div className="text-xl font-semibold text-orange-400">{liveData.pre_turbo_right.toFixed(0)}°F</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-slate-800/30">
            <div className="text-xs text-slate-400">Post-Turbo Left</div>
            <div className="text-xl font-semibold text-cyan-400">{liveData.post_turbo_left.toFixed(0)}°F</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-slate-800/30">
            <div className="text-xs text-slate-400">Post-Turbo Right</div>
            <div className="text-xl font-semibold text-cyan-400">{liveData.post_turbo_right.toFixed(0)}°F</div>
          </div>
        </div>
      </section>

      {/* Bearing Temperatures */}
      <section className="glass-card p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Main Bearing Temperatures</h3>
        <div className="grid grid-cols-3 md:grid-cols-9 gap-3">
          {liveData.bearing_temps.map((temp, idx) => {
            const status = temp > 190 ? 'critical' : temp > 180 ? 'warning' : 'normal';
            return (
              <div key={idx} className={`text-center p-4 rounded-xl ${
                status === 'critical' ? 'bg-red-500/20 border border-red-500/50' :
                status === 'warning' ? 'bg-amber-500/20 border border-amber-500/50' :
                'bg-slate-800/50'
              }`}>
                <div className="text-xs text-slate-400 mb-1">Brg {idx + 1}</div>
                <div className={`text-2xl font-bold ${
                  status === 'critical' ? 'text-red-400' :
                  status === 'warning' ? 'text-amber-400' : 'text-emerald-400'
                }`}>{temp.toFixed(1)}°</div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
