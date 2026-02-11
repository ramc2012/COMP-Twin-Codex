import { useState, useEffect } from 'react';
import { ConfigHeader } from '../components/ConfigHeader';
import { initialRegisters } from '../data/initialRegisters';
import { fetchModbusConfig, updateModbusConfig } from '../lib/api';
import { useUnit } from '../contexts/UnitContext';
import type { RegisterDef } from '../data/initialRegisters';

interface SimRegister extends RegisterDef {
    currentValue: number;
}

export function SimulatorDashboard() {
    const { unitId } = useUnit();
    // STRICT MODE: No random values. Initialize with default/0.
    const [registers, setRegisters] = useState<SimRegister[]>(() =>
        initialRegisters.map(reg => ({
            ...reg,
            currentValue: reg.type === 'Discrete' ? 0 : 0 // Start at 0 for all
        }))
    );

    const [activeCategory, setActiveCategory] = useState<string>('All');
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saveSuccess, setSaveSuccess] = useState(false);
    
    // Connection Settings
    const [connection, setConnection] = useState({
        ip: '0.0.0.0',
        port: 5020,
        slaveId: 1,
        status: 'Running',
        clients: 1,
        latency: 0,
        errorRate: 0
    });

    const mapRegistersFromConfig = (configRegisters: any[] | undefined): SimRegister[] => {
        if (!Array.isArray(configRegisters) || configRegisters.length === 0) {
            return initialRegisters.map(reg => ({ ...reg, currentValue: reg.defaultValue ?? 0 }));
        }

        const fallbackByAddress = new Map(initialRegisters.map((r) => [r.address, r]));
        return configRegisters.map((r: any) => {
            const fallback = fallbackByAddress.get(Number(r.address));
            const defaultValue = Number(
                r?.nominal ??
                r?.default ??
                r?.currentValue ??
                fallback?.defaultValue ??
                0
            );
            const min = Number(r?.min ?? fallback?.min ?? 0);
            const max = Number(r?.max ?? fallback?.max ?? 1000);
            const inferredDiscrete = String(r?.unit || '').toLowerCase() === 'state' || (min === 0 && max === 1);

            return {
                address: Number(r?.address ?? fallback?.address ?? 0),
                name: String(r?.name ?? fallback?.name ?? 'Unnamed Register'),
                description: String(r?.description ?? fallback?.description ?? ''),
                unit: String(r?.unit ?? fallback?.unit ?? ''),
                category: String(r?.category ?? fallback?.category ?? 'General'),
                type: fallback?.type ?? (inferredDiscrete ? 'Discrete' : 'Analog'),
                min,
                max,
                defaultValue,
                currentValue: defaultValue
            } as SimRegister;
        });
    };

    // Load config from backend on mount
    useEffect(() => {
        const loadConfig = async () => {
            try {
                const config = await fetchModbusConfig(unitId);
                if (config.server) {
                    setConnection(prev => ({
                        ...prev,
                        ip: config.server?.host || prev.ip,
                        port: config.server?.port || prev.port,
                        slaveId: config.server?.slave_id || prev.slaveId
                    }));
                }
                setRegisters(mapRegistersFromConfig(config.registers));
            } catch (err) {
                console.error('Failed to load simulator config:', err);
            }
        };
        loadConfig();
    }, [unitId]);

    const handleSave = async () => {
        setIsSaving(true);
        setSaveError(null);
        setSaveSuccess(false);

        try {
            const configPayload = {
                server: {
                    host: connection.ip,
                    port: connection.port,
                    slave_id: connection.slaveId
                },
                simulation: {
                    update_interval_ms: 100,
                    noise_enabled: false,
                    trend_enabled: false
                },
                registers: registers.map(reg => ({
                    ...reg,
                    nominal: reg.currentValue,
                    default: reg.currentValue
                }))
            };

            await updateModbusConfig(unitId, configPayload);
            setSaveSuccess(true);
            setIsEditing(false);

            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (err: any) {
            setSaveError(err.message || 'Failed to save simulator settings');
        } finally {
            setIsSaving(false);
        }
    };

    const updateValue = (address: number, newValue: number) => {
        setRegisters(prev => prev.map(reg =>
            reg.address === address ? { ...reg, currentValue: newValue } : reg
        ));
    };

    // Extract unique categories
    const categories = ['All', ...Array.from(new Set(registers.map(r => r.category))).sort()];

    const filteredRegisters = activeCategory === 'All' ? registers : registers.filter(r => r.category === activeCategory);

    return (
        <div className="min-h-screen p-6">
            <ConfigHeader
                title="Modbus Simulator Dashboard"
                description="Emulate hardware registers. Configure simulator server settings."
                isEditing={isEditing}
                canEdit={true}
                onEditToggle={() => setIsEditing(!isEditing)}
                onSave={handleSave}
                isSaving={isSaving}
            />

            {/* Save Feedback */}
            {saveError && (
                <div className="mb-4 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-300 text-sm">
                    ❌ Error: {saveError}
                </div>
            )}
            {saveSuccess && (
                <div className="mb-4 p-4 bg-green-500/10 border border-green-500/20 rounded-lg text-green-300 text-sm">
                    ✅ Simulator settings saved! The simulator will automatically reload.
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

                {/* Left Column: Controls & Settings */}
                <div className="space-y-6">

                    {/* Status Panel */}
                    <div className="glass-card p-6 border-l-4 border-l-cyan-500">
                        <h2 className="text-xl font-bold text-white mb-2">Simulator Status</h2>
                        <p className="text-slate-400 text-sm">Running in Strict Mode.</p>
                        <p className="text-slate-500 text-xs mt-2">Values will only change via manual input below or external Modbus Write commands.</p>
                    </div>

                    {/* Connection Settings */}
                    <div className="glass-card p-6 border-t-4 border-t-purple-500">
                        <h2 className="text-xl font-bold text-white mb-4">Server Settings</h2>
                        <div className="space-y-4">
                            <div className="grid grid-cols-3 gap-2">
                                <div className="col-span-2">
                                    <label className="text-slate-400 text-xs block mb-1">Bind IP</label>
                                    <input
                                        value={connection.ip}
                                        disabled={!isEditing}
                                        onChange={(e) => setConnection({ ...connection, ip: e.target.value })}
                                        className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white font-mono text-sm disabled:opacity-50"
                                    />
                                </div>
                                <div>
                                    <label className="text-slate-400 text-xs block mb-1">Port</label>
                                    <input
                                        type="number"
                                        value={connection.port}
                                        disabled={!isEditing}
                                        onChange={(e) => setConnection({ ...connection, port: parseInt(e.target.value) })}
                                        className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white font-mono text-sm disabled:opacity-50"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="text-slate-400 text-xs block mb-1">Slave ID (Unit Address)</label>
                                <input
                                    type="number"
                                    value={connection.slaveId}
                                    min={1}
                                    max={247}
                                    disabled={!isEditing}
                                    onChange={(e) => setConnection({ ...connection, slaveId: parseInt(e.target.value) })}
                                    className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-white font-mono text-sm disabled:opacity-50"
                                />
                                <span className="text-slate-500 text-[10px]">Range: 1-247</span>
                            </div>

                            <div className="flex justify-between items-center p-3 bg-slate-800/50 rounded-lg">
                                <span className="text-sm text-slate-300">Status</span>
                                <span className="text-green-400 font-bold flex items-center gap-2">
                                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                                    {connection.status}
                                </span>
                            </div>

                            <div className="flex justify-between items-center p-3 bg-slate-800/50 rounded-lg">
                                <span className="text-sm text-slate-300">Clients</span>
                                <span className="text-white font-mono font-bold">{connection.clients}</span>
                            </div>

                            <hr className="border-slate-700/50" />

                            <div>
                                <label className="text-slate-400 text-xs block mb-1">Simulated Latency</label>
                                <input
                                    type="range" min="0" max="2000" step="50"
                                    value={connection.latency}
                                    disabled={!isEditing}
                                    onChange={(e) => setConnection({ ...connection, latency: parseInt(e.target.value) })}
                                    className="w-full accent-yellow-500 disabled:opacity-50"
                                />
                                <div className="text-right text-yellow-400 font-mono text-xs">{connection.latency} ms</div>
                            </div>

                            <div>
                                <label className="text-slate-400 text-xs block mb-1">Error Rate</label>
                                <input
                                    type="range" min="0" max="100" step="1"
                                    value={connection.errorRate}
                                    disabled={!isEditing}
                                    onChange={(e) => setConnection({ ...connection, errorRate: parseInt(e.target.value) })}
                                    className="w-full accent-red-500 disabled:opacity-50"
                                />
                                <div className="text-right text-red-400 font-mono text-xs">{connection.errorRate}%</div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right Column: Register Grid */}
                <div className="lg:col-span-3 flex flex-col h-[calc(100vh-8rem)]">
                    {/* Category Filter */}
                    <div className="flex gap-2 overflow-x-auto pb-4 mb-2 shrink-0">
                        {categories.map(cat => (
                            <button
                                key={cat}
                                onClick={() => setActiveCategory(cat)}
                                className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${activeCategory === cat
                                        ? 'bg-cyan-500 text-white shadow-lg shadow-cyan-500/20'
                                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                                    }`}
                            >
                                {cat}
                            </button>
                        ))}
                    </div>

                    <div className="overflow-y-auto pr-2 pb-10 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 auto-rows-min">
                        {filteredRegisters.map(reg => (
                            <div key={reg.address} className="glass-card p-4 flex flex-col gap-3 group hover:border-cyan-500/30 transition-all h-fit">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <span className="font-mono text-xs text-slate-500 block mb-1">ADDR: {reg.address}</span>
                                        <h3 className="text-white font-bold text-sm truncate w-48" title={reg.name}>{reg.name}</h3>
                                        <p className="text-[10px] text-slate-400 truncate w-48" title={reg.description}>{reg.description}</p>
                                    </div>
                                    <span className={`px-2 py-1 rounded text-[10px] font-bold ${reg.type === 'Analog' ? 'bg-blue-500/10 text-blue-400' : 'bg-orange-500/10 text-orange-400'}`}>
                                        {reg.type === 'Analog' ? 'ANA' : 'DIG'}
                                    </span>
                                </div>

                                {reg.type === 'Analog' ? (
                                    <>
                                        <div className="flex items-center gap-2 mt-2">
                                            <input
                                                type="range"
                                                min={reg.min}
                                                max={reg.max}
                                                value={reg.currentValue}
                                                onChange={(e) => updateValue(reg.address, parseFloat(e.target.value))}
                                                className="flex-1 accent-cyan-500"
                                            />
                                        </div>
                                        <div className="flex justify-between items-end border-t border-white/5 pt-2">
                                            <span className="text-xs text-slate-500">Range: {reg.min}-{reg.max}</span>
                                            <div className="text-right">
                                                <input
                                                    type="number"
                                                    value={Math.round(reg.currentValue * 100) / 100}
                                                    onChange={(e) => updateValue(reg.address, parseFloat(e.target.value))}
                                                    className="w-20 bg-transparent text-right font-mono font-bold text-lg text-cyan-400 focus:outline-none border-b border-transparent focus:border-cyan-500"
                                                />
                                                <span className="text-xs text-slate-400 ml-1">{reg.unit}</span>
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/5">
                                        <span className="text-xs text-slate-500">State Control</span>
                                        <button
                                            onClick={() => updateValue(reg.address, reg.currentValue ? 0 : 1)}
                                            className={`px-4 py-1 rounded font-bold text-sm transition-all ${reg.currentValue
                                                    ? 'bg-green-500 text-white shadow-lg shadow-green-500/20'
                                                    : 'bg-slate-700 text-slate-400'
                                                }`}
                                        >
                                            {reg.currentValue ? 'ON / ACTIVE' : 'OFF / INACTIVE'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
