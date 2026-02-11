/**
 * UnitSelector - Dropdown for selecting active unit
 */
import { useUnit } from '../contexts/UnitContext';
import { useLocation, useNavigate } from 'react-router-dom';

export function UnitSelector() {
    const { unitId, setUnitId, units, loading } = useUnit();
    const navigate = useNavigate();
    const location = useLocation();

    const switchPackage = (nextUnitId: string) => {
        setUnitId(nextUnitId);
        const match = location.pathname.match(/^\/packages\/[^/]+(\/.*)?$/);
        const suffix = match?.[1] || '/dashboard';
        navigate(`/packages/${nextUnitId}${suffix}`);
    };

    if (loading) {
        return (
            <div className="space-y-2">
                <div className="h-9 rounded bg-slate-800/60 animate-pulse" />
                <div className="h-9 rounded bg-slate-800/40 animate-pulse" />
                <div className="h-9 rounded bg-slate-800/40 animate-pulse" />
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {units.map((unit, index) => {
                const active = unit.unit_id === unitId;
                const packageName = `Package ${index + 1}`;
                return (
                    <button
                        key={unit.unit_id}
                        type="button"
                        onClick={() => switchPackage(unit.unit_id)}
                        className={`w-full rounded-lg border px-3 py-2 text-left transition-all ${
                            active
                                ? 'bg-cyan-500/15 border-cyan-500/50'
                                : 'bg-slate-900/50 border-slate-700/60 hover:border-slate-500/60'
                        }`}
                    >
                        <div className="flex items-center justify-between">
                            <span className={`text-xs font-semibold ${active ? 'text-cyan-300' : 'text-slate-400'}`}>
                                {packageName}
                            </span>
                            <span className={`text-[10px] ${unit.is_active ? 'text-emerald-400' : 'text-slate-500'}`}>
                                {unit.is_active ? 'ACTIVE' : 'OFFLINE'}
                            </span>
                        </div>
                        <div className={`text-sm mt-0.5 ${active ? 'text-white' : 'text-slate-300'}`}>
                            {unit.unit_id}
                        </div>
                    </button>
                );
            })}
        </div>
    );
}
