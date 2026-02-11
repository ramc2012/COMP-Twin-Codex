/**
 * CompressorPage - Detailed compressor view with all stage information
 */
import { useEffect } from 'react';
import { useDataStore } from '../store/useDataStore';
import { fetchLiveData } from '../lib/api';
import { StageCard } from '../components/StageCard';

export function CompressorPage() {
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
        <span className="text-slate-400">Loading compressor data...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-white">Compressor Detail</h1>
        <p className="text-slate-400 mt-1">Unit: {liveData.unit_id}</p>
      </header>

      {/* Overall Metrics */}
      <section className="glass-card p-6 mb-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="text-center">
            <span className="text-sm text-slate-400">Overall Ratio</span>
            <div className="text-4xl font-bold text-purple-400 mt-2">{liveData.overall_ratio}</div>
          </div>
          <div className="text-center">
            <span className="text-sm text-slate-400">Total BHP</span>
            <div className="text-4xl font-bold text-cyan-400 mt-2">{liveData.total_bhp}</div>
          </div>
          <div className="text-center">
            <span className="text-sm text-slate-400">Comp Oil Pressure</span>
            <div className="text-4xl font-bold text-emerald-400 mt-2">{liveData.comp_oil_press} <span className="text-lg text-slate-500">PSIG</span></div>
          </div>
          <div className="text-center">
            <span className="text-sm text-slate-400">Comp Oil Temp</span>
            <div className="text-4xl font-bold text-amber-400 mt-2">{liveData.comp_oil_temp} <span className="text-lg text-slate-500">°F</span></div>
          </div>
        </div>
      </section>

      {/* Stages */}
      <section className="mb-8">
        <h2 className="text-lg font-semibold text-slate-300 mb-4">Compression Stages</h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {liveData.stages.map((stage) => (
            <StageCard key={stage.stage} data={stage} />
          ))}
        </div>
      </section>

      {/* Pressure Cascade */}
      <section className="glass-card p-6 mb-8">
        <h3 className="text-lg font-semibold text-white mb-4">Pressure Cascade</h3>
        <div className="relative h-16 flex items-center">
          {/* Suction */}
          <div className="absolute left-0 text-center">
            <div className="text-xs text-slate-400">Suction</div>
            <div className="text-lg font-semibold text-cyan-400">{liveData.stages[0]?.suction_press.toFixed(0)} PSIG</div>
          </div>
          
          {/* Stages visualization */}
          <div className="flex-1 mx-20 relative">
            <div className="absolute inset-0 flex">
              {liveData.stages.map((stage, idx) => (
                <div key={stage.stage} className="flex-1 flex items-center">
                  <div className="h-2 flex-1 rounded-l-full" style={{
                    background: `linear-gradient(to right, ${idx === 0 ? '#22d3ee' : '#3b82f6'}, #3b82f6)`
                  }}></div>
                  <div className="text-center px-2">
                    <div className="text-xs text-slate-500">Stg {stage.stage}</div>
                    <div className="text-sm font-semibold text-blue-400">{stage.discharge_press.toFixed(0)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          {/* Discharge */}
          <div className="absolute right-0 text-center">
            <div className="text-xs text-slate-400">Discharge</div>
            <div className="text-lg font-semibold text-blue-400">{liveData.stages[2]?.discharge_press.toFixed(0)} PSIG</div>
          </div>
        </div>
      </section>

      {/* Cylinder Discharge Temps */}
      <section className="glass-card p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Cylinder Discharge Temperatures</h3>
        <div className="grid grid-cols-4 gap-4">
          {liveData.cylinder_temps.map((temp, idx) => (
            <div key={idx} className="text-center p-4 rounded-xl bg-slate-800/50">
              <div className="text-sm text-slate-400 mb-2">Cylinder {idx + 1}</div>
              <div className={`text-3xl font-bold ${
                temp > 350 ? 'text-red-400' : temp > 300 ? 'text-amber-400' : 'text-emerald-400'
              }`}>
                {temp.toFixed(1)}°
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
