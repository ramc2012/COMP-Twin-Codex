/**
 * Modbus Mapping Page
 * Configure Modbus registers for the unit.
 */
import { useState, useEffect, type MouseEvent } from 'react';
import { ConfigHeader } from '../../components/ConfigHeader';
import { useUnit } from '../../contexts/UnitContext';
import { fetchModbusConfig, updateModbusConfig } from '../../lib/api';
import { initialRegisters } from '../../data/initialRegisters';

interface RegisterMapping {
    address: number;
    name: string;
    description: string;
    bit?: number;
    unit: string;
    scale: number;
    offset: number;
    dataType: string;
    category: string;
    pollGroup: string;
    type?: 'Analog' | 'Discrete';
    min?: number | null;
    max?: number | null;
    nominal?: number;
    default?: number;
    liveValue?: number | string | null;
    valueMode?: 'LIVE' | 'MANUAL';
    manualValue?: number | null;
    sourcePriority?: string | string[];
    calcFormula?: string;
    interstage_dp?: number | null;
    cooler_approach_f?: number | null;
    speed_ratio?: number | null;
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
    communication_mode: 'TCP_IP' | 'RS485_RTU';
    serial_port: string;
    baud_rate: number;
    parity: 'N' | 'E' | 'O';
    stop_bits: number;
    byte_size: number;
}

interface CalibrationDialogState {
    unit: string;
    min: string;
    max: string;
    scale: string;
    offset: string;
    valueMode: 'LIVE' | 'MANUAL';
    manualValue: string;
}

export function ModbusMappingPage() {
    const defaultServerSettings: ModbusServerConfig = {
        host: 'simulator',
        port: 5020,
        slave_id: 1,
        timeout_ms: 1000,
        scan_rate_ms: 1000,
        use_simulation: true,
        real_host: '',
        real_port: 502,
        sim_host: 'simulator',
        sim_port: 5020,
        communication_mode: 'TCP_IP',
        serial_port: '/dev/ttyUSB0',
        baud_rate: 9600,
        parity: 'N',
        stop_bits: 1,
        byte_size: 8
    };

    const { unitId } = useUnit();
    const [isEditing, setIsEditing] = useState(false);
    const [config, setConfig] = useState<{ server: ModbusServerConfig; registers: RegisterMapping[] } | null>(null);
    const [registers, setRegisters] = useState<RegisterMapping[]>([]);
    const [serverSettings, setServerSettings] = useState<ModbusServerConfig | null>(null);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [filter, setFilter] = useState('');
    const [typeFilter, setTypeFilter] = useState<'ALL' | 'Analog' | 'Discrete'>('ALL');
    const [lastLoadedAt, setLastLoadedAt] = useState<string>('');
    const [calibrationIndex, setCalibrationIndex] = useState<number | null>(null);
    const [calibrationDraft, setCalibrationDraft] = useState<CalibrationDialogState>({
        unit: 'none',
        min: '',
        max: '',
        scale: '1',
        offset: '0',
        valueMode: 'LIVE',
        manualValue: ''
    });

    useEffect(() => {
        loadConfig();
    }, [unitId]);

    const loadConfig = async () => {
        try {
            const [data, liveSnapshot] = await Promise.all([
                fetchModbusConfig(unitId),
                fetch('/api/units/' + unitId + '/live').then(async (r) => {
                    if (!r.ok) return null;
                    return r.json();
                }).catch(() => null)
            ]);
            setConfig(data);
            const byAddress = new Map(initialRegisters.map((r) => [Number(r.address), r]));
            const configRegisters = Array.isArray(data.registers) ? data.registers : [];

            if (configRegisters.length > 0) {
                const normalized = configRegisters.map((reg: any) => {
                    const base = byAddress.get(Number(reg.address));
                    return {
                        address: Number(reg.address ?? base?.address ?? 0),
                        name: String(reg.name ?? base?.name ?? `reg_${reg.address}`),
                        description: String(reg.description ?? base?.description ?? ''),
                        bit: reg.bit === null || reg.bit === undefined ? undefined : Number(reg.bit),
                        unit: String(reg.unit ?? base?.unit ?? ''),
                        scale: Number(reg.scale ?? 1),
                        offset: Number(reg.offset ?? 0),
                        dataType: String(reg.dataType ?? reg.data_type ?? 'uint16'),
                        category: String(reg.category ?? base?.category ?? 'general'),
                        pollGroup: String(reg.pollGroup ?? reg.poll_group ?? 'A'),
                        type: (reg.type || base?.type || 'Analog') as 'Analog' | 'Discrete',
                        min: reg.min === null || reg.min === undefined ? null : Number(reg.min),
                        max: reg.max === null || reg.max === undefined ? null : Number(reg.max),
                        nominal: Number(reg.nominal ?? reg.default ?? base?.defaultValue ?? 0),
                        default: Number(reg.default ?? reg.nominal ?? base?.defaultValue ?? 0),
                        liveValue: liveSnapshot?.[reg.name] ?? null,
                        valueMode: String(reg.valueMode || reg.value_mode || 'LIVE').toUpperCase() === 'MANUAL' ? 'MANUAL' : 'LIVE',
                        manualValue: reg.manualValue ?? reg.manual_value ?? null,
                        sourcePriority: reg.sourcePriority ?? reg.source_priority,
                        calcFormula: reg.calcFormula ?? reg.calculationFormula ?? reg.calc_formula ?? '',
                        interstage_dp: reg.interstage_dp ?? null,
                        cooler_approach_f: reg.cooler_approach_f ?? null,
                        speed_ratio: reg.speed_ratio ?? null
                    } as RegisterMapping;
                });
                setRegisters(normalized);
            } else {
                const fallback = initialRegisters.map((base) => ({
                    address: Number(base.address),
                    name: String(base.name),
                    description: String(base.description ?? ''),
                    unit: String(base.unit ?? ''),
                    scale: 1,
                    offset: 0,
                    dataType: 'uint16',
                    category: String(base.category ?? 'general'),
                    pollGroup: 'A',
                    type: (base.type || 'Analog') as 'Analog' | 'Discrete',
                    min: Number(base.min ?? 0),
                    max: Number(base.max ?? 1000),
                    nominal: Number(base.defaultValue ?? 0),
                    default: Number(base.defaultValue ?? 0),
                    liveValue: liveSnapshot?.[base.name] ?? null,
                    valueMode: 'LIVE' as const,
                    manualValue: null,
                    sourcePriority: undefined,
                    calcFormula: '',
                    interstage_dp: null,
                    cooler_approach_f: null,
                    speed_ratio: null
                }));
                setRegisters(fallback);
            }
            const rawServer = data.server || {};
            const normalizedServer: ModbusServerConfig = {
                ...defaultServerSettings,
                ...rawServer,
                communication_mode: String(rawServer.communication_mode || 'TCP_IP').toUpperCase() === 'RS485_RTU' ? 'RS485_RTU' : 'TCP_IP',
                parity: (['N', 'E', 'O'].includes(String(rawServer.parity || 'N').toUpperCase()) ? String(rawServer.parity || 'N').toUpperCase() : 'N') as 'N' | 'E' | 'O',
                serial_port: String(rawServer.serial_port || '/dev/ttyUSB0')
            };
            setServerSettings(normalizedServer);
            setLastLoadedAt(new Date().toISOString());
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

    const activeConnectionLabel = () => {
        if (!serverSettings) return 'N/A';
        if (serverSettings.use_simulation) {
            return `${serverSettings.sim_host}:${serverSettings.sim_port} (Simulation TCP)`;
        }
        if (serverSettings.communication_mode === 'RS485_RTU') {
            return `${serverSettings.serial_port} (${serverSettings.baud_rate}, ${serverSettings.byte_size}${serverSettings.parity}${serverSettings.stop_bits})`;
        }
        return `${serverSettings.real_host || 'Not Set'}:${serverSettings.real_port || 502} (Real TCP)`;
    };

    const filteredRegisters = registers.filter(r =>
        (typeFilter === 'ALL' || (r.type || 'Analog') === typeFilter) &&
        (
            r.name.toLowerCase().includes(filter.toLowerCase()) ||
            r.description.toLowerCase().includes(filter.toLowerCase()) ||
            r.address.toString().includes(filter)
        )
    );

    const unitOptions = ['PSIG', 'BAR', '°F', '°C', 'RPM', '%', 'State', 'A', 'V', 'BHP', 'ratio', 'none'];
    const activeCalibrationRegister = calibrationIndex !== null ? registers[calibrationIndex] : null;

    const formatNumber = (value: any, digits = 2) => {
        if (value === null || value === undefined || value === '') return 'N/A';
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return 'N/A';
        return parsed.toFixed(digits);
    };

    const openCalibrationDialog = (index: number) => {
        const reg = registers[index];
        if (!reg) return;
        setCalibrationIndex(index);
        setCalibrationDraft({
            unit: reg.unit || 'none',
            min: reg.min === null || reg.min === undefined ? '' : String(reg.min),
            max: reg.max === null || reg.max === undefined ? '' : String(reg.max),
            scale: reg.scale === null || reg.scale === undefined ? '1' : String(reg.scale),
            offset: reg.offset === null || reg.offset === undefined ? '0' : String(reg.offset),
            valueMode: reg.valueMode === 'MANUAL' ? 'MANUAL' : 'LIVE',
            manualValue: reg.manualValue === null || reg.manualValue === undefined ? '' : String(reg.manualValue)
        });
    };

    const applyCalibrationDialog = () => {
        if (calibrationIndex === null) return;
        setRegisters((prev) => {
            const next = [...prev];
            const current = next[calibrationIndex];
            if (!current) return prev;
            const regType = current.type || 'Analog';
            next[calibrationIndex] = {
                ...current,
                unit: calibrationDraft.unit === 'none' ? '' : calibrationDraft.unit,
                scale: Number.isFinite(Number(calibrationDraft.scale)) ? Number(calibrationDraft.scale) : 1,
                offset: Number.isFinite(Number(calibrationDraft.offset)) ? Number(calibrationDraft.offset) : 0,
                valueMode: calibrationDraft.valueMode,
                manualValue: calibrationDraft.valueMode === 'MANUAL'
                    ? (calibrationDraft.manualValue.trim() === '' ? null : Number(calibrationDraft.manualValue))
                    : null,
                ...(regType === 'Analog'
                    ? {
                        min: calibrationDraft.min.trim() === '' ? null : Number(calibrationDraft.min),
                        max: calibrationDraft.max.trim() === '' ? null : Number(calibrationDraft.max)
                    }
                    : {})
            };
            return next;
        });
        setCalibrationIndex(null);
    };

    const stopRowClick = (e: MouseEvent) => {
        e.stopPropagation();
    };

    const exportSnapshots = async () => {
        try {
            const [live, resolved] = await Promise.all([
                fetch(`/api/units/${unitId}/live`).then(async (r) => (r.ok ? r.json() : { error: await r.text() })).catch((e) => ({ error: String(e) })),
                fetch(`/api/units/${unitId}/resolved`).then(async (r) => (r.ok ? r.json() : { error: await r.text() })).catch((e) => ({ error: String(e) }))
            ]);

            const payload = {
                exported_at: new Date().toISOString(),
                unit_id: unitId,
                modbus_config_snapshot: {
                    server: serverSettings,
                    registers
                },
                live_snapshot: live,
                calculated_resolved_snapshot: resolved
            };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${unitId}_modbus_validation_snapshot_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error('Export failed:', e);
            setSaveStatus('error');
        }
    };

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

            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-slate-400">
                    Last refresh: {lastLoadedAt ? new Date(lastLoadedAt).toLocaleTimeString() : 'N/A'}
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={loadConfig}
                        className="px-3 py-1.5 rounded border border-slate-700 text-slate-200 text-xs hover:bg-slate-800/60"
                    >
                        Refresh Live Values
                    </button>
                    <button
                        type="button"
                        onClick={exportSnapshots}
                        className="px-3 py-1.5 rounded border border-cyan-500/40 text-cyan-300 text-xs hover:bg-cyan-500/10"
                    >
                        Export Validation Snapshot
                    </button>
                </div>
            </div>

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
                        <div className="text-sm font-semibold text-slate-200 mb-2">Per-Parameter Value Source</div>
                        <div className="text-xs text-slate-400 mb-3 leading-5">
                            <span className="inline-flex items-center rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 mr-1">LIVE</span>
                            uses strict live PLC value only.{' '}
                            <span className="inline-flex items-center rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300 mr-1">MANUAL</span>
                            uses user-specified manual value. Click any register row to edit source/value/calibration.
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
                        Active Connection: <span className="text-white font-mono">{activeConnectionLabel()}</span>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Real World Settings */}
                    <div className={`p-4 rounded-lg border ${!serverSettings.use_simulation ? 'bg-slate-800/50 border-cyan-500/30' : 'bg-slate-900/30 border-slate-800 opacity-50'}`}>
                        <h3 className="text-sm font-semibold text-slate-300 mb-3 block">Real World PLC Settings</h3>
                        <div className="grid grid-cols-1 gap-4">
                            <div>
                                <label className="block text-xs text-slate-500 mb-1">Communication</label>
                                <select
                                    value={serverSettings.communication_mode}
                                    disabled={!isEditing || serverSettings.use_simulation}
                                    onChange={(e) => updateServerSetting('communication_mode', e.target.value === 'RS485_RTU' ? 'RS485_RTU' : 'TCP_IP')}
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-cyan-500 disabled:opacity-50"
                                >
                                    <option value="TCP_IP">TCP/IP</option>
                                    <option value="RS485_RTU">RS485 (RTU)</option>
                                </select>
                            </div>

                            {serverSettings.communication_mode === 'RS485_RTU' ? (
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs text-slate-500 mb-1">Serial Port</label>
                                        <input
                                            type="text"
                                            value={serverSettings.serial_port || ''}
                                            disabled={!isEditing || serverSettings.use_simulation}
                                            onChange={(e) => updateServerSetting('serial_port', e.target.value)}
                                            placeholder="/dev/ttyUSB0"
                                            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-cyan-500 disabled:opacity-50"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-500 mb-1">Baud</label>
                                        <input
                                            type="number"
                                            value={serverSettings.baud_rate || 9600}
                                            disabled={!isEditing || serverSettings.use_simulation}
                                            onChange={(e) => updateServerSetting('baud_rate', parseInt(e.target.value, 10) || 9600)}
                                            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-cyan-500 disabled:opacity-50"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-500 mb-1">Parity</label>
                                        <select
                                            value={serverSettings.parity}
                                            disabled={!isEditing || serverSettings.use_simulation}
                                            onChange={(e) => updateServerSetting('parity', (e.target.value || 'N') as 'N' | 'E' | 'O')}
                                            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-cyan-500 disabled:opacity-50"
                                        >
                                            <option value="N">None (N)</option>
                                            <option value="E">Even (E)</option>
                                            <option value="O">Odd (O)</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-500 mb-1">Frame</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            <input
                                                type="number"
                                                value={serverSettings.byte_size || 8}
                                                disabled={!isEditing || serverSettings.use_simulation}
                                                onChange={(e) => updateServerSetting('byte_size', parseInt(e.target.value, 10) || 8)}
                                                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-cyan-500 disabled:opacity-50"
                                                title="Byte size"
                                            />
                                            <input
                                                type="number"
                                                value={serverSettings.stop_bits || 1}
                                                disabled={!isEditing || serverSettings.use_simulation}
                                                onChange={(e) => updateServerSetting('stop_bits', parseInt(e.target.value, 10) || 1)}
                                                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-cyan-500 disabled:opacity-50"
                                                title="Stop bits"
                                            />
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs text-slate-500 mb-1">IP Address</label>
                                        <input
                                            type="text"
                                            value={serverSettings.real_host || ''}
                                            disabled={!isEditing || serverSettings.use_simulation}
                                            onChange={(e) => updateServerSetting('real_host', e.target.value)}
                                            placeholder="192.168.1.10"
                                            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-cyan-500 disabled:opacity-50"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-500 mb-1">Port</label>
                                        <input
                                            type="number"
                                            value={serverSettings.real_port || 502}
                                            disabled={!isEditing || serverSettings.use_simulation}
                                            onChange={(e) => updateServerSetting('real_port', parseInt(e.target.value, 10) || 502)}
                                            placeholder="502"
                                            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-cyan-500 disabled:opacity-50"
                                        />
                                    </div>
                                </div>
                            )}
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
                    <div className="flex items-center gap-2">
                        <select
                            value={typeFilter}
                            onChange={(e) => setTypeFilter(e.target.value as any)}
                            className="px-3 py-1 bg-slate-800 border border-slate-700 rounded text-sm text-white focus:outline-none focus:border-cyan-500"
                        >
                            <option value="ALL">All Input Types</option>
                            <option value="Analog">Analog</option>
                            <option value="Discrete">Discrete</option>
                        </select>
                        <input
                            type="text"
                            placeholder="Search registers..."
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                            className="px-3 py-1 bg-slate-800 border border-slate-700 rounded text-sm text-white focus:outline-none focus:border-cyan-500"
                        />
                    </div>
                </div>
                <div className="mb-3 text-xs text-slate-400">
                    Click any row to open parameter dialog for source, manual value, and calibration.
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-slate-400 border-b border-slate-700/50 text-left">
                                <th className="p-2">Addr</th>
                                <th className="p-2">Name</th>
                                <th className="p-2">Description</th>
                                <th className="p-2">Input</th>
                                <th className="p-2">Live Value</th>
                                <th className="p-2">Calibration</th>
                                <th className="p-2">Type</th>
                                <th className="p-2">Group</th>
                                <th className="p-2">Mode</th>
                            </tr>
                        </thead>
                        <tbody className="text-slate-300">
                            {filteredRegisters.length === 0 ? (
                                <tr><td colSpan={9} className="p-4 text-center text-slate-500">No registers found</td></tr>
                            ) : filteredRegisters.map((reg) => {
                                // Find actual index in main array for editing
                                const index = registers.indexOf(reg);
                                return (
                                    <tr
                                        key={index}
                                        onClick={() => openCalibrationDialog(index)}
                                        className={`border-b border-slate-700/30 hover:bg-slate-800/30 cursor-pointer ${
                                            calibrationIndex === index ? 'bg-cyan-500/10 ring-1 ring-cyan-500/35' : ''
                                        }`}
                                    >
                                        <td className="p-2">
                                            <input
                                                type="number"
                                                value={reg.address}
                                                disabled={!isEditing}
                                                onChange={(e) => updateRegister(index, 'address', parseInt(e.target.value))}
                                                onClick={stopRowClick}
                                                className="w-16 bg-transparent border-none focus:ring-1 focus:ring-cyan-500 rounded px-1"
                                            />
                                        </td>
                                        <td className="p-2">
                                            <input
                                                value={reg.name}
                                                disabled={!isEditing}
                                                onChange={(e) => updateRegister(index, 'name', e.target.value)}
                                                onClick={stopRowClick}
                                                className="w-full bg-transparent border-none focus:ring-1 focus:ring-cyan-500 rounded px-1"
                                            />
                                        </td>
                                        <td className="p-2">
                                            <div className="text-slate-100">{reg.description || '-'}</div>
                                        </td>
                                        <td className="p-2 text-xs text-slate-400">{reg.type || 'Analog'}</td>
                                        <td className="p-2">
                                            <span className="text-xs text-cyan-300">{reg.liveValue ?? 'N/A'}</span>
                                        </td>
                                        <td className="p-2">
                                            <div className="w-full rounded border border-slate-700/60 bg-slate-900/50 px-2 py-1 text-left">
                                                <div className="text-xs text-slate-200">Unit: {reg.unit || 'none'}</div>
                                                <div className="text-[11px] text-slate-400">
                                                    {(reg.type || 'Analog') === 'Analog'
                                                        ? `Min ${formatNumber(reg.min, 1)} / Max ${formatNumber(reg.max, 1)}`
                                                        : 'Discrete input'}
                                                </div>
                                                <div className="text-[11px] text-slate-500">
                                                    Scale {formatNumber(reg.scale, 3)} | Offset {formatNumber(reg.offset, 3)}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-2">
                                            <select
                                                value={reg.dataType}
                                                disabled={!isEditing}
                                                onChange={(e) => updateRegister(index, 'dataType', e.target.value)}
                                                onClick={stopRowClick}
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
                                                onClick={stopRowClick}
                                                className="w-10 bg-transparent border-none focus:ring-1 focus:ring-cyan-500 rounded px-1 text-center"
                                            />
                                        </td>
                                        <td className="p-2 text-xs">
                                            <span className={`inline-flex rounded border px-2 py-0.5 ${
                                                reg.valueMode === 'MANUAL'
                                                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                                                    : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                                            }`}>
                                                {reg.valueMode === 'MANUAL' ? 'MANUAL' : 'LIVE'}
                                            </span>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {activeCalibrationRegister && (
                <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-900 p-5">
                        <div className="flex items-start justify-between gap-4 mb-4">
                            <div>
                                <h3 className="text-lg font-semibold text-white">Parameter Calibration</h3>
                                <p className="text-sm text-slate-300">
                                    {activeCalibrationRegister.name} (Addr {activeCalibrationRegister.address})
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setCalibrationIndex(null)}
                                className="px-2.5 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800"
                            >
                                ✕
                            </button>
                        </div>

                        <div className="mb-4 rounded-lg border border-slate-700/70 bg-slate-950/60 p-3">
                            <div className="text-xs text-slate-400">Description</div>
                            <div className="text-sm text-slate-100">{activeCalibrationRegister.description || '-'}</div>
                            <div className="mt-2 text-xs text-slate-500">
                                Input type: <span className="text-slate-300">{activeCalibrationRegister.type || 'Analog'}</span>
                                {activeCalibrationRegister.bit !== undefined && (
                                    <span className="ml-3">Bit: <span className="text-slate-300">{activeCalibrationRegister.bit}</span></span>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Value Source</label>
                                <select
                                    value={calibrationDraft.valueMode}
                                    disabled={!isEditing}
                                    onChange={(e) => setCalibrationDraft((prev) => ({
                                        ...prev,
                                        valueMode: e.target.value === 'MANUAL' ? 'MANUAL' : 'LIVE'
                                    }))}
                                    className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white disabled:opacity-60"
                                >
                                    <option value="LIVE">LIVE (strict PLC value)</option>
                                    <option value="MANUAL">MANUAL (override)</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Manual Value</label>
                                <input
                                    type="number"
                                    step="any"
                                    value={calibrationDraft.manualValue}
                                    disabled={!isEditing || calibrationDraft.valueMode !== 'MANUAL'}
                                    onChange={(e) => setCalibrationDraft((prev) => ({ ...prev, manualValue: e.target.value }))}
                                    className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white disabled:opacity-60"
                                    placeholder={calibrationDraft.valueMode === 'MANUAL' ? 'Enter manual value' : 'Enabled when mode is MANUAL'}
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Unit</label>
                                <select
                                    value={calibrationDraft.unit}
                                    disabled={!isEditing}
                                    onChange={(e) => setCalibrationDraft((prev) => ({ ...prev, unit: e.target.value }))}
                                    className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white disabled:opacity-60"
                                >
                                    {unitOptions.map((u) => (
                                        <option key={u} value={u}>{u}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Scale</label>
                                <input
                                    type="number"
                                    step="any"
                                    value={calibrationDraft.scale}
                                    disabled={!isEditing}
                                    onChange={(e) => setCalibrationDraft((prev) => ({ ...prev, scale: e.target.value }))}
                                    className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white disabled:opacity-60"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Offset</label>
                                <input
                                    type="number"
                                    step="any"
                                    value={calibrationDraft.offset}
                                    disabled={!isEditing}
                                    onChange={(e) => setCalibrationDraft((prev) => ({ ...prev, offset: e.target.value }))}
                                    className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white disabled:opacity-60"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Min (Analog only)</label>
                                <input
                                    type="number"
                                    step="any"
                                    value={calibrationDraft.min}
                                    disabled={!isEditing || (activeCalibrationRegister.type || 'Analog') !== 'Analog'}
                                    onChange={(e) => setCalibrationDraft((prev) => ({ ...prev, min: e.target.value }))}
                                    className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white disabled:opacity-60"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Max (Analog only)</label>
                                <input
                                    type="number"
                                    step="any"
                                    value={calibrationDraft.max}
                                    disabled={!isEditing || (activeCalibrationRegister.type || 'Analog') !== 'Analog'}
                                    onChange={(e) => setCalibrationDraft((prev) => ({ ...prev, max: e.target.value }))}
                                    className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white disabled:opacity-60"
                                />
                            </div>
                        </div>

                        <div className="mt-5 flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setCalibrationIndex(null)}
                                className="px-4 py-2 rounded border border-slate-700 text-slate-300 hover:bg-slate-800"
                            >
                                Close
                            </button>
                            <button
                                type="button"
                                onClick={applyCalibrationDialog}
                                disabled={!isEditing}
                                className="px-4 py-2 rounded bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-50"
                            >
                                {isEditing ? 'Apply Calibration' : 'Enable Edit to Apply'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
