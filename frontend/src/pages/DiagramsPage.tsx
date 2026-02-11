/**
 * DiagramsPage - PV and PT diagram visualization page
 */
import { useState } from 'react';
import { PVDiagram } from '../components/PVDiagram';
import { PTDiagram } from '../components/PTDiagram';

export function DiagramsPage() {
  const [selectedStage, setSelectedStage] = useState(1);
  const unitId = 'GCS-001';

  return (
    <div className="min-h-screen p-6">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-white">PV / PT Diagrams</h1>
        <p className="text-slate-400 mt-1">Thermodynamic state diagrams synthesized from live operating conditions</p>
      </header>

      {/* PT Diagram */}
      <section className="mb-8">
        <PTDiagram unitId={unitId} />
      </section>

      {/* PV Diagrams for each stage */}
      <section>
        <div className="flex items-center gap-4 mb-4">
          <h2 className="text-lg font-semibold text-slate-300">PV Diagrams by Stage</h2>
          <div className="flex gap-2">
            {[1, 2, 3].map((stage) => (
              <button
                key={stage}
                onClick={() => setSelectedStage(stage)}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  selectedStage === stage
                    ? 'bg-blue-500 text-white'
                    : 'bg-slate-700/50 text-slate-400 hover:bg-slate-700'
                }`}
              >
                Stage {stage}
              </button>
            ))}
          </div>
        </div>
        
        <PVDiagram unitId={unitId} stage={selectedStage} />
      </section>
      
      {/* Info section */}
      <section className="mt-8 glass-card p-6">
        <h3 className="text-lg font-semibold text-white mb-4">About These Diagrams</h3>
        <div className="grid md:grid-cols-2 gap-6 text-sm text-slate-400">
          <div>
            <h4 className="text-blue-400 font-medium mb-2">PV Diagram (Pressure-Volume)</h4>
            <p>
              Shows the thermodynamic cycle of a single compression stage. The enclosed area 
              represents the work done per cycle. The diagram is synthesized from current 
              operating pressures assuming polytropic compression/expansion.
            </p>
            <ul className="mt-2 space-y-1 list-disc list-inside text-slate-500">
              <li>1→2: Compression stroke</li>
              <li>2→3: Discharge at constant pressure</li>
              <li>3→4: Re-expansion of clearance gas</li>
              <li>4→1: Suction stroke</li>
            </ul>
          </div>
          <div>
            <h4 className="text-purple-400 font-medium mb-2">PT Diagram (Pressure-Temperature)</h4>
            <p>
              Shows the thermodynamic path through all compression stages. Each point 
              represents a state in the compression system - suction, discharge, and 
              after interstage cooling.
            </p>
            <ul className="mt-2 space-y-1 list-disc list-inside text-slate-500">
              <li>Steep lines: Compression (temp rises with pressure)</li>
              <li>Horizontal drops: Interstage coolers (pressure drop, cooling)</li>
              <li>Final point: System discharge conditions</li>
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
