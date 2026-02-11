/**
 * StageCard - Displays compression stage data with pressures, temps, and efficiencies
 */

interface StageData {
  stage: number;
  suction_press: number;
  discharge_press: number;
  suction_temp: number;
  discharge_temp: number;
  ratio: number;
  isentropic_eff: number;
  volumetric_eff: number;
  ideal_temp: number;
}

interface StageCardProps {
  data: StageData;
}

export function StageCard({ data }: StageCardProps) {
  const efficiencyColor = (eff: number) => {
    if (eff >= 80) return 'text-emerald-400';
    if (eff >= 70) return 'text-amber-400';
    return 'text-red-400';
  };
  
  const tempDiff = data.discharge_temp - data.ideal_temp;
  const tempStatus = tempDiff <= 20 ? 'text-emerald-400' : tempDiff <= 40 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="glass-card p-4 hover:scale-[1.01] transition-transform duration-300">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Stage {data.stage}</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Ratio</span>
          <span className="text-xl font-bold text-blue-400">{data.ratio.toFixed(2)}</span>
        </div>
      </div>
      
      {/* Pressure bar visualization */}
      <div className="mb-4">
        <div className="flex justify-between text-xs text-slate-400 mb-1">
          <span>Suction</span>
          <span>Discharge</span>
        </div>
        <div className="relative h-2 bg-slate-700 rounded-full overflow-hidden">
          <div 
            className="absolute left-0 top-0 h-full bg-gradient-to-r from-cyan-500 to-blue-500"
            style={{ width: `${(data.suction_press / data.discharge_press) * 100}%` }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-lg font-semibold text-cyan-400">{data.suction_press.toFixed(1)} <span className="text-xs text-slate-500">PSIG</span></span>
          <span className="text-lg font-semibold text-blue-400">{data.discharge_press.toFixed(1)} <span className="text-xs text-slate-500">PSIG</span></span>
        </div>
      </div>
      
      {/* Temperatures */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <span className="text-xs text-slate-400">Suction T</span>
          <div className="text-lg font-semibold text-slate-300">{data.suction_temp.toFixed(1)}°F</div>
        </div>
        <div>
          <span className="text-xs text-slate-400">Discharge T</span>
          <div className={`text-lg font-semibold ${tempStatus}`}>{data.discharge_temp.toFixed(1)}°F</div>
          <div className="text-xs text-slate-500">Ideal: {data.ideal_temp.toFixed(1)}°F</div>
        </div>
      </div>
      
      {/* Efficiencies */}
      <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-700/50">
        <div>
          <span className="text-xs text-slate-400">Isentropic Eff.</span>
          <div className={`text-xl font-bold ${efficiencyColor(data.isentropic_eff)}`}>
            {data.isentropic_eff.toFixed(1)}%
          </div>
        </div>
        <div>
          <span className="text-xs text-slate-400">Volumetric Eff.</span>
          <div className={`text-xl font-bold ${efficiencyColor(data.volumetric_eff)}`}>
            {data.volumetric_eff.toFixed(1)}%
          </div>
        </div>
      </div>
    </div>
  );
}
