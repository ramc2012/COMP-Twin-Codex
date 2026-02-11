/**
 * ConfigPage - System configuration hub
 * Updated: Explicit package scope UX + stronger per-package identity
 */
import { Link, useNavigate } from 'react-router-dom';
import { useUnit } from '../contexts/UnitContext';

const CONFIG_SECTIONS = [
    {
        id: 'equipment',
        title: 'Equipment Specs',
        description: 'Compressor & Engine mechanical specifications',
        icon: '⚙️',
        path: 'config/equipment',
        color: 'from-blue-500/20 to-cyan-500/20 text-cyan-400 border-cyan-500/30'
    },
    {
        id: 'gas',
        title: 'Gas Properties',
        description: 'Gas composition and properties configuration',
        icon: '🧪',
        path: 'config/gas',
        color: 'from-emerald-500/20 to-teal-500/20 text-emerald-400 border-emerald-500/30'
    },
    {
        id: 'site',
        title: 'Site Conditions',
        description: 'Atmospheric conditions and cooling parameters',
        icon: '🌍',
        path: 'config/site',
        color: 'from-amber-500/20 to-orange-500/20 text-orange-400 border-orange-500/30'
    },
    {
        id: 'alarms',
        title: 'Alarm Setpoints',
        description: 'Configure alarm thresholds and delays',
        icon: '🚨',
        path: 'config/alarms',
        color: 'from-red-500/20 to-rose-500/20 text-red-400 border-red-500/30'
    },
    {
        id: 'modbus',
        title: 'Modbus Mapping',
        description: 'Map Modbus registers and data-source behavior',
        icon: '🔌',
        path: 'config/modbus',
        color: 'from-violet-500/20 to-indigo-500/20 text-violet-300 border-violet-500/30'
    },
    {
        id: 'users',
        title: 'User Management',
        description: 'Manage users, roles and access permissions',
        icon: '👥',
        path: 'config/users',
        color: 'from-slate-500/20 to-gray-500/20 text-slate-300 border-slate-500/30'
    }
];

const PACKAGE_THEME = [
    'from-cyan-500/20 to-blue-500/20 border-cyan-500/40',
    'from-emerald-500/20 to-teal-500/20 border-emerald-500/40',
    'from-amber-500/20 to-orange-500/20 border-amber-500/40',
    'from-violet-500/20 to-indigo-500/20 border-violet-500/40',
    'from-rose-500/20 to-pink-500/20 border-rose-500/40'
];

export function ConfigPage() {
    const navigate = useNavigate();
    const { unitId, setUnitId, units, activeUnit } = useUnit();
    const activeIndex = Math.max(0, units.findIndex((unit) => unit.unit_id === unitId));
    const activeTheme = PACKAGE_THEME[activeIndex % PACKAGE_THEME.length];
    const scopeTone = [
        'text-cyan-300 border-cyan-500/30 bg-cyan-500/10',
        'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
        'text-amber-300 border-amber-500/30 bg-amber-500/10',
        'text-violet-300 border-violet-500/30 bg-violet-500/10',
        'text-rose-300 border-rose-500/30 bg-rose-500/10'
    ][activeIndex % 5];

    return (
        <div className="min-h-screen p-6">
            <div className={`mb-6 rounded-2xl border bg-gradient-to-r p-5 ${activeTheme}`}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-bold text-white">⚙️ Configuration Workspace</h1>
                        <p className="text-slate-200/90 mt-1">
                            Settings are isolated per compressor package. You are editing <span className="font-semibold text-white">{unitId}</span>.
                        </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className={`rounded-md border px-3 py-2 ${scopeTone}`}>
                            <div className="text-[10px] uppercase tracking-wide opacity-80">Package Scope</div>
                            <div className="font-semibold">{unitId}</div>
                        </div>
                        <div className="rounded-md border border-slate-600/60 bg-slate-900/50 px-3 py-2 text-slate-200">
                            <div className="text-[10px] uppercase tracking-wide text-slate-400">Stages</div>
                            <div className="font-semibold">{activeUnit?.stage_count ?? 0}</div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="mb-8">
                <h2 className="text-lg font-semibold text-slate-200 mb-3">Choose Package Scope</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {units.map((unit, index) => {
                        const active = unit.unit_id === unitId;
                        const theme = PACKAGE_THEME[index % PACKAGE_THEME.length];
                        return (
                            <button
                                key={unit.unit_id}
                                type="button"
                                onClick={() => {
                                    setUnitId(unit.unit_id);
                                    navigate(`/packages/${unit.unit_id}/config`);
                                }}
                                aria-pressed={active}
                                className={`rounded-xl border p-4 text-left transition-all bg-gradient-to-br ${
                                    active
                                        ? `${theme} shadow-[0_0_0_1px_rgba(34,211,238,0.3)] scale-[1.01]`
                                        : 'from-slate-900/70 to-slate-800/60 border-slate-700/60 hover:border-slate-500/60'
                                }`}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="text-sm font-semibold text-slate-200">Package {index + 1}</div>
                                    <div className={`text-xs ${unit.is_active ? 'text-emerald-400' : 'text-slate-500'}`}>
                                        {unit.is_active ? 'ACTIVE' : 'OFFLINE'}
                                    </div>
                                </div>
                                <div className="mt-1 text-white font-medium">{unit.unit_id}</div>
                                <div className="text-xs text-slate-300/90 mt-1">{unit.stage_count} stages</div>
                                <div className={`text-[11px] mt-2 ${active ? 'text-cyan-200' : 'text-slate-500'}`}>
                                    {active ? 'Editing this package now (isolated settings)' : `Switch to edit ${unit.unit_id}`}
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="mb-4 rounded-lg border border-slate-700/60 bg-slate-900/45 px-4 py-3 text-xs text-slate-300">
                Active configuration scope: <span className="font-semibold text-white">{unitId}</span>. Opening any section below edits only this package.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {CONFIG_SECTIONS.map(section => (
                    <Link
                        key={section.id}
                        to={`/packages/${unitId}/${section.path}`}
                        className={`block p-6 rounded-xl border transition-all hover:-translate-y-1 hover:shadow-lg bg-gradient-to-br ${section.color}`}
                    >
                        <div className="flex items-start justify-between mb-4">
                            <div className="text-4xl">{section.icon}</div>
                            <span className="text-[10px] px-2 py-1 rounded border border-white/20 bg-black/10 text-slate-200">
                                {unitId}
                            </span>
                        </div>
                        <h2 className="text-xl font-bold mb-2 text-white">{section.title}</h2>
                        <p className="text-sm opacity-80">{section.description}</p>
                    </Link>
                ))}
            </div>

            <div className="mt-8 p-4 rounded-lg bg-slate-800/50 border border-slate-700/50">
                <div className="flex items-center gap-3">
                    <span className="text-2xl">ℹ️</span>
                    <div>
                        <h3 className="text-white font-medium">Configuration Note</h3>
                        <p className="text-sm text-slate-400">
                            All edits on this page are package-specific. Confirm the scope badge ({unitId}) before saving.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
