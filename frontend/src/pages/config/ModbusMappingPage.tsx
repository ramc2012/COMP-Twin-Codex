/**
 * Modbus Mapping Page
 * Configure Modbus registers for the unit.
 */
import { useState, useEffect } from 'react';
import { ConfigHeader } from '../../components/ConfigHeader';
import { useUnit } from '../../contexts/UnitContext';
import { fetchModbusConfig, getDataValueMode, setDataValueMode, type DataValueMode, updateModbusConfig } from '../../lib/api';

interface RegisterMapping {
    address: number;
    name: string;
    description: string;
    unit: string;
    scale: number;
    offset: number;
    dataType: string;
    category: string;
    pollGroup: string;
}

interface ModbusServerConfig {
    host: string;
    port: number;
    slave_id: number;
    timeout_ms: number;
    scan_rate_ms: number;
    use_simulation: boolean;
    real_host: string;
    real_port: number;
    sim_host: string;
    sim_port: number;
}

export function ModbusMappingPage() {
    const { unitId } = useUnit();
    const [isEditing, setIsEditing] = useState(false);
    const [config, setConfig] = useState<{ server: ModbusServerConfig; registers: RegisterMapping[] } | null>(null);
    const [registers, setRegisters] = useState<RegisterMapping[]>([]);
    const [serverSettings, setServerSettings] = useState<ModbusServerConfig | null>(null);
    const [dataValueMode, setDataValueModeState] = useState<DataValueMode>('LIVE');
    const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [filter, setFilter] = useState('');

    useEffect(() => {
        loadConfig();
    }, [unitId]);

    const loadConfig = async () => {
        try {
            const data = await fetchModbusConfig(unitId);
            setConfig(data);
            setRegisters(data.registers || []);
            setServerSettings(data.server || null);
            setDataValueModeState(getDataValueMode(unitId));
        } catch (e) {
            console.error('Failed to load Modbus config:', e);
        }
    };

    const handleSave = async () => {
        if (!config || !serverSettings) return;
        setSaveStatus('idle');
        try {
            await updateModbusConfig(unitId, {
                server: serverSettings,
                registers
            });
            setDataValueMode(unitId, dataValueMode);
            await loadConfig();
            setSaveStatus('success');
            setIsEditing(false);
            setTimeout(() => setSaveStatus('idle'), 3000);
        } catch (e) {
            setSaveStatus('error');
            console.error('Save failed:', e);
        }
    };

    const updateRegister = (index: number, field: keyof RegisterMapping, value: any) => {
        const newRegs = [...registers];
        newRegs[index] = { ...newRegs[index], [field]: value };
        setRegisters(newRegs);
    };

    const updateServerSetting = (field: keyof ModbusServerConfig, value: any) => {
        if (!serverSettings) return;
        setServerSettings({ ...serverSettings, [field]: value });
    };

    const filteredRegisters = registers.filter(r =>
        r.name.toLowerCase().includes(filter.toLowerCase()) ||
        r.description.toLowerCase().includes(filter.toLowerCase()) ||
        r.address.toString().includes(filter)
    );

    if (!config || !serverSettings) return <div className="p-6 text-white">Loading...</div>;

    return (
        <div className="min-h-screen p-6">
            <ConfigHeader
                title="Modbus Register Mapping"
                description={`Configure Modbus registers for ${unitId}`}
                isEditing={isEditing}
                onEditToggle={() => setIsEditing(!isEditing)}
                onSave={handleSave}
            />

            {saveStatus === 'success' && (
                <div className="mb-4 p-3 bg-green-500/20 border border-green-500/50 rounded-lg text-green-400 text-sm">
                    ✓ Configuration saved
                </div>
            )}
            {saveStatus === 'error' && (
                <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
                    ✗ Failed to save configuration
                </div>
            )}

            {/* Connection Settings */}
            <div className="glass-card p-6 mb-6">
                <h2 className="text-xl font-semibold text-white mb-4">Connection Settings</h2>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
                    <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 p-4">
                        <div className="text-sm font-semibold text-slate-200 mb-2">Dashboard Value Source</div>
                        <div className="text-xs text-slate-400 mb-3 leading-5">
                            <span className="inline-flex items-center rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 mr-1">LIVE</span>
                            shows strict live values only (no hold-last-good fallback).{' '}
                            <span className="inline-flex items-center rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300 mr-1">MANUAL</span>
                            shows resolved/manual override values.
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                disabled={!isEditing}
                                onClick={() => setDataValueModeState('LIVE')}
                                className={`px-3 py-1.5 rounded-md border text-xs ${
                                    dataValueMode === 'LIVE'
                                        ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300'
                                        : 'bg-slate-800 border-slate-700 text-slate-300'
                                } disabled:opacity-50`}
                            >
                                LIVE
                            </button>
                            <button
                                type="button"
                                disabled={!isEditing}
                                onClick={() => setDataValueModeState('MANUAL')}
                                className={`px-3 py-1.5 rounded-md border text-xs ${
                                    dataValueMode === 'MANUAL'
                                        ? 'bg-amber-500/20 border-amber-400/40 text-amber-300'
                                        : 'bg-slate-800 border-slate-700 text-slate-300'
                                } disabled:opacity-50`}
                            >
                                MANUAL
                            </button>
                            <span className="text-xs text-slate-500 ml-2">Current: {dataValueMode}</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <label className="text-slate-300">Run Mode:</label>
                        <div className={`
                            relative inline-flex h-6 w-11 items-center rounded-full transition-colors
                            ${serverSettings.use_simulation ? 'bg-cyan-600' : 'bg-slate-600'}
                        `}
                            onClick={() => isEditing && updateServerSetting('use_simulation', !serverSettings.use_simulation)}
                            style={{ cursor: isEditing ? 'pointer' : 'default' }}
                        >
                            <span className={`
                                inline-block h-4 w-4 transform rounded-full bg-white transition-transform
                                ${serverSettings.use_simulation ? 'translate-x-6' : 'translate-x-1'}
                            `} />
                        </div>
                        <span className={`text-sm font-medium ${serverSettings.use_simulation ? 'text-cyan-400' : 'text-slate-400'}`}>
                            {serverSettings.use_simulation ? 'Simulation Mode' : 'Real World Mode'}
                        </span>
                    </div>

                    <div className="border-l border-slate-700 pl-4 text-sm text-slate-400">
                        Active Connection: <span className="text-white font-mono">{serverSettings.use_simulation ? serverSettings.sim_host : (serverSettings.real_host || 'Not Set')} : {serverSettings.use_simulation ? serverSettings.sim_port : (serverSettings.real_port || 502)}</span>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Real World Settings */}
                    <div className={`p-4 rounded-lg border ${!serverSettings.use_simulation ? 'bg-slate-800/50 border-cyan-500/30' : 'bg-slate-900/30 border-slate-800 opacity-50'}`}>
                        <h3 className="text-sm font-semibold text-slate-300 mb-3 block">Real World PLC Settings</h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs text-slate-500 mb-1">IP Address</label>
                                <input
                                    type="text"
                                    value={serverSettings.real_host || ''}
                                    disabled={!isEditing}
                                    onChange={(e) => updateServerSetting('real_host', e.target.value)}
                                    placeholder="192.168.1.10"
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-cyan-500 disabled:opacity-50"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-500 mb-1">Port</label>
                                <input
                                    type="number"
                                    value={serverSettings.real_port || ''}
                                    disabled={!isEditing}
                                    onChange={(e) => updateServerSetting('real_port', parseInt(e.target.value))}
                                    placeholder="502"
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-cyan-500 disabled:opacity-50"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Common Settings */}
                    <div className="p-4 rounded-lg border bg-slate-800/50 border-slate-700/50">
                        <h3 className="text-sm font-semibold text-slate-300 mb-3 block">Common Settings</h3>
                        <div className="grid grid-cols-3 gap-4">
                            <div>
                                <label className="block text-xs text-slate-500 mb-1">Slave ID</label>
                                <input
                                    type="number"
                                    value={serverSettings.slave_id}
                                    disabled={!isEditing}
                                    onChange={(e) => updateServerSetting('slave_id', parseInt(e.target.value))}
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-cyan-500 disabled:opacity-50"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-500 mb-1">Timeout (ms)</label>
                                <input
                                    type="number"
                                    value={serverSettings.timeout_ms}
                                    disabled={!isEditing}
                                    onChange={(e) => updateServerSetting('timeout_ms', parseInt(e.target.value))}
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-cyan-500 disabled:opacity-50"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-500 mb-1">Scan Rate (ms)</label>
                                <input
                                    type="number"
                                    value={serverSettings.scan_rate_ms}
                                    disabled={!isEditing}
                                    onChange={(e) => updateServerSetting('scan_rate_ms', parseInt(e.target.value))}
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-cyan-500 disabled:opacity-50"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Registers Table */}
            <div className="glass-card p-6">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold text-white">Registers ({registers.length})</h2>
                    <input
                        type="text"
                        placeholder="Search registers..."
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        className="px-3 py-1 bg-slate-800 border border-slate-700 rounded text-sm text-white focus:outline-none focus:border-cyan-500"
                    />
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-slate-400 border-b border-slate-700/50 text-left">
                                <th className="p-2">Addr</th>
                                <th className="p-2">Name</th>
                                <th className="p-2">Description</th>
                                <th className="p-2">Unit</th>
                                <th className="p-2">Scale</th>
                                <th className="p-2">Offset</th>
                                <th className="p-2">Type</th>
                                <th className="p-2">Group</th>
                            </tr>
                        </thead>
                        <tbody className="text-slate-300">
                            {filteredRegisters.length === 0 ? (
                                <tr><td colSpan={8} className="p-4 text-center text-slate-500">No registers found</td></tr>
                            ) : filteredRegisters.map((reg) => {
                                // Find actual index in main array for editing
                                const index = registers.indexOf(reg);
                                return (
                                    <tr key={index} className="border-b border-slate-700/30 hover:bg-slate-800/30">
                                        <td className="p-2">
                                            <input
                                                type="number"
                                                value={reg.address}
                                                disabled={!isEditing}
                                                onChange={(e) => updateRegister(index, 'address', parseInt(e.target.value))}
                                                className="w-16 bg-transparent border-none focus:ring-1 focus:ring-cyan-500 rounded px-1"
                                            />
                                        </td>
                                        <td className="p-2">
                                            <input
                                                value={reg.name}
                                                disabled={!isEditing}
                                                onChange={(e) => updateRegister(index, 'name', e.target.value)}
                                                className="w-full bg-transparent border-none focus:ring-1 focus:ring-cyan-500 rounded px-1"
                                            />
                                        </td>
                                        <td className="p-2">
                                            <input
                                                value={reg.description || ''}
                                                disabled={!isEditing}
                                                onChange={(e) => updateRegister(index, 'description', e.target.value)}
                                                className="w-full bg-transparent border-none focus:ring-1 focus:ring-cyan-500 rounded px-1"
                                            />
                                        </td>
                                        <td className="p-2">
                                            <input
                                                value={reg.unit || ''}
                                                disabled={!isEditing}
                                                onChange={(e) => updateRegister(index, 'unit', e.target.value)}
                                                className="w-16 bg-transparent border-none focus:ring-1 focus:ring-cyan-500 rounded px-1"
                                            />
                                        </td>
                                        <td className="p-2">
                                            <input
                                                type="number"
                                                value={reg.scale}
                                                disabled={!isEditing}
                                                onChange={(e) => updateRegister(index, 'scale', parseFloat(e.target.value))}
                                                className="w-16 bg-transparent border-none focus:ring-1 focus:ring-cyan-500 rounded px-1"
                                            />
                                        </td>
                                        <td className="p-2">
                                            <input
                                                type="number"
                                                value={reg.offset}
                                                disabled={!isEditing}
                                                onChange={(e) => updateRegister(index, 'offset', parseFloat(e.target.value))}
                                                className="w-16 bg-transparent border-none focus:ring-1 focus:ring-cyan-500 rounded px-1"
                                            />
                                        </td>
                                        <td className="p-2">
                                            <select
                                                value={reg.dataType}
                                                disabled={!isEditing}
                                                onChange={(e) => updateRegister(index, 'dataType', e.target.value)}
                                                className="bg-transparent border-none focus:ring-1 focus:ring-cyan-500 rounded px-1 text-xs"
                                            >
                                                <option value="uint16">UINT16</option>
                                                <option value="int16">INT16</option>
                                                <option value="uint32">UINT32</option>
                                                <option value="float32">FLOAT32</option>
                                            </select>
                                        </td>
                                        <td className="p-2">
                                            <input
                                                value={reg.pollGroup}
                                                disabled={!isEditing}
                                                onChange={(e) => updateRegister(index, 'pollGroup', e.target.value)}
                                                className="w-10 bg-transparent border-none focus:ring-1 focus:ring-cyan-500 rounded px-1 text-center"
                                            />
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
