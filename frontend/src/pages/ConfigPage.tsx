import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useUnit } from '../contexts/UnitContext';
import { fetchUnit, updateUnit } from '../lib/api';

const CONFIG_SECTIONS = [
    {
        id: 'equipment',
        title: 'Equipment Specs',
        description: 'Compressor & engine mechanical specifications',
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

export function ConfigPage() {
    const { unitId, activeUnit, refreshUnits } = useUnit();
    const [name, setName] = useState('');
    const [tag, setTag] = useState('');
    const [editingIdentity, setEditingIdentity] = useState(false);
    const [loadingIdentity, setLoadingIdentity] = useState(true);
    const [savingIdentity, setSavingIdentity] = useState(false);
    const [identityStatus, setIdentityStatus] = useState<'idle' | 'saved' | 'error'>('idle');
    const [identityError, setIdentityError] = useState<string>('');

    useEffect(() => {
        let mounted = true;
        const loadIdentity = async () => {
            setLoadingIdentity(true);
            setIdentityStatus('idle');
            setIdentityError('');
            try {
                const detail = await fetchUnit(unitId);
                if (!mounted) return;
                setName(String(detail?.name || activeUnit?.name || unitId));
                setTag(String(detail?.tag || detail?.description || ''));
                setEditingIdentity(false);
            } catch {
                if (!mounted) return;
                setName(activeUnit?.name || unitId);
                setTag('');
                setEditingIdentity(false);
            } finally {
                if (mounted) setLoadingIdentity(false);
            }
        };
        loadIdentity();
        return () => {
            mounted = false;
        };
    }, [unitId, activeUnit?.name]);

    const saveIdentity = async () => {
        if (!name.trim()) {
            setIdentityStatus('error');
            setIdentityError('Package name is required.');
            return;
        }
        setSavingIdentity(true);
        setIdentityStatus('idle');
        setIdentityError('');
        try {
            await updateUnit(unitId, {
                name: name.trim(),
                tag: tag.trim()
            });
            await refreshUnits();
            setEditingIdentity(false);
            setIdentityStatus('saved');
            setTimeout(() => setIdentityStatus('idle'), 2500);
        } catch (e: any) {
            setIdentityStatus('error');
            setIdentityError(e?.message || 'Failed to update package identity');
        } finally {
            setSavingIdentity(false);
        }
    };

    return (
        <div className="min-h-screen p-6">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-white">Configuration</h1>
                <p className="text-slate-400 mt-1">
                    Package configuration sections for <span className="text-slate-200 font-semibold">{unitId}</span>.
                </p>
            </div>

            <div className="mb-6 rounded-xl border border-slate-700/60 bg-slate-900/45 p-4">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-lg font-semibold text-slate-100">Package Identity</h2>
                    <div className="flex items-center gap-2">
                        <div className="text-xs text-slate-400">ID: {unitId}</div>
                        <button
                            type="button"
                            onClick={() => setEditingIdentity((v) => !v)}
                            className={`h-8 w-8 rounded border text-sm ${
                                editingIdentity
                                    ? 'border-cyan-500/60 bg-cyan-500/15 text-cyan-200'
                                    : 'border-slate-700 bg-slate-800 text-slate-200 hover:border-slate-500'
                            }`}
                            title={editingIdentity ? 'Close edit' : 'Edit package identity'}
                        >
                            ✎
                        </button>
                    </div>
                </div>
                {loadingIdentity ? (
                    <div className="text-sm text-slate-400">Loading package identity...</div>
                ) : !editingIdentity ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="rounded border border-slate-700/70 bg-slate-800/40 px-3 py-2">
                            <div className="text-[11px] text-slate-500 uppercase tracking-wide">Package Name</div>
                            <div className="text-sm text-slate-100 mt-0.5">{name || '-'}</div>
                        </div>
                        <div className="rounded border border-slate-700/70 bg-slate-800/40 px-3 py-2">
                            <div className="text-[11px] text-slate-500 uppercase tracking-wide">Package Tag</div>
                            <div className="text-sm text-slate-100 mt-0.5">{tag || '-'}</div>
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                        <div>
                            <label className="block text-xs text-slate-400 mb-1">Package Name</label>
                            <input
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
                                placeholder="Compressor Package A"
                            />
                        </div>
                        <div>
                            <label className="block text-xs text-slate-400 mb-1">Package Tag</label>
                            <input
                                value={tag}
                                onChange={(e) => setTag(e.target.value)}
                                className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500"
                                placeholder="Area-01 / Train-A / Site tag"
                            />
                        </div>
                        <button
                            type="button"
                            onClick={saveIdentity}
                            disabled={savingIdentity || !editingIdentity}
                            className="rounded bg-cyan-600 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-700 disabled:opacity-60"
                        >
                            {savingIdentity ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                )}
                {identityStatus === 'saved' && (
                    <div className="mt-3 text-sm text-emerald-300">Package identity saved.</div>
                )}
                {identityStatus === 'error' && (
                    <div className="mt-3 text-sm text-rose-300">{identityError}</div>
                )}
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
        </div>
    );
}
