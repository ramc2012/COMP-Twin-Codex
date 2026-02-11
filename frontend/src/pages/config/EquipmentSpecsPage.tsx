import { useState, useEffect } from 'react';
import { ConfigHeader } from '../../components/ConfigHeader';
import { useUnit } from '../../contexts/UnitContext';
import { fetchEquipmentConfig, saveEquipmentConfig, type StageConfig } from '../../lib/api';

interface EngineConfig {
    manufacturer: string;
    model: string;
    serialNumber: string;
    fuelType: string;
    numCylinders: number;
    configuration: 'V' | 'inline';
    bore: number;
    stroke: number;
    ratedBHP: number;
    ratedRPM: number;
    turbo: boolean;
    intercooled: boolean;
    couplingType: string;
    speedRatio: string;
    mechEfficiency: number;
}

interface CompressorConfig {
    manufacturer: string;
    model: string;
    serialNumber: string;
    numStages: number;
    compressorType: string;
    frameRatingHP: number;
    maxRodLoad: number;
    stages: StageConfig[];
}

const defaultStage: StageConfig = {
    cylinders: 2, action: 'double_acting', boreDiameter: 8, strokeLength: 5, rodDiameter: 2,
    clearanceHE: 18, clearanceCE: 20, designSuctionPressure: 50, designDischargePressure: 150,
    designSuctionTemp: 80, suctionPressSource: 'Modbus:300', dischargePressSource: 'Modbus:301',
    suctionTempSource: 'Modbus:302', dischargeTempSource: 'Modbus:303'
};

export function EquipmentSpecsPage() {
    const { unitId, stageCount } = useUnit();
    const [activeTab, setActiveTab] = useState<'compressor' | 'engine'>('compressor');
    const [activeStage, setActiveStage] = useState(0);
    const [isEditing, setIsEditing] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');

    const [compressor, setCompressor] = useState<CompressorConfig>({
        manufacturer: 'Ariel', model: 'JGK/4', serialNumber: 'F-12345', numStages: 3,
        compressorType: 'Reciprocating', frameRatingHP: 1500, maxRodLoad: 65000,
        stages: Array(3).fill(null).map(() => ({ ...defaultStage }))
    });

    const [engine, setEngine] = useState<EngineConfig>({
        manufacturer: 'Caterpillar', model: 'G3516', serialNumber: 'E-98765',
        fuelType: 'Natural Gas', numCylinders: 16, configuration: 'V',
        bore: 6.69, stroke: 7.48, ratedBHP: 1500, ratedRPM: 1200,
        turbo: true, intercooled: true, couplingType: 'Direct', speedRatio: '1.0:1', mechEfficiency: 97
    });

    // Load config from backend on mount
    useEffect(() => {
        const loadConfig = async () => {
            try {
                const config = await fetchEquipmentConfig(unitId);
                if (config.compressor) {
                    setCompressor(prev => ({ ...prev, ...config.compressor }));
                }
                if (config.engine) {
                    setEngine(prev => ({ ...prev, ...config.engine }));
                }
            } catch (e) {
                console.log('Using default config:', e);
            }
        };
        loadConfig();
    }, [unitId]);

    // Update stages when stageCount changes
    useEffect(() => {
        if (stageCount && stageCount !== compressor.stages.length) {
            const newStages = Array(stageCount).fill(null).map((_, i) =>
                compressor.stages[i] || { ...defaultStage }
            );
            setCompressor(prev => ({ ...prev, numStages: stageCount, stages: newStages }));
        }
    }, [stageCount]);

    const handleSave = async () => {
        setSaveStatus('idle');
        try {
            await saveEquipmentConfig(unitId, { compressor, engine } as any);
            setSaveStatus('success');
            setIsEditing(false);
            setTimeout(() => setSaveStatus('idle'), 3000);
        } catch (e) {
            setSaveStatus('error');
            console.error('Save failed:', e);
        }
    };

    const updateStage = (index: number, field: keyof StageConfig, value: any) => {
        const newStages = [...compressor.stages];
        newStages[index] = { ...newStages[index], [field]: value };
        setCompressor({ ...compressor, stages: newStages });
    };

    const InputField = ({ label, value, onChange, unit = '', type = 'text' }: any) => (
        <div className="flex flex-col gap-1">
            <label className="text-slate-400 text-xs">{label}</label>
            <div className="flex items-center gap-2">
                <input type={type} value={value} disabled={!isEditing}
                    onChange={(e) => onChange(type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)}
                    className={`w-full px-3 py-2 border rounded text-sm focus:outline-none focus:border-cyan-500/50 ${!isEditing ? 'bg-slate-700/30 border-slate-700/50 text-slate-400' : 'bg-slate-800/50 border-slate-600/50 text-white'
                        }`}
                />
                {unit && <span className="text-slate-400 text-xs whitespace-nowrap">{unit}</span>}
            </div>
        </div>
    );

    const SelectField = ({ label, value, options, onChange }: any) => (
        <div className="flex flex-col gap-1">
            <label className="text-slate-400 text-xs">{label}</label>
            <select value={value} disabled={!isEditing} onChange={(e) => onChange(e.target.value)}
                className={`px-3 py-2 border rounded text-sm focus:outline-none focus:border-cyan-500/50 ${!isEditing ? 'bg-slate-700/30 border-slate-700/50 text-slate-400' : 'bg-slate-800/50 border-slate-600/50 text-white'
                    }`}
            >
                {options.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
        </div>
    );

    const SourceField = ({ label, value, onChange }: any) => (
        <div className="flex flex-col gap-1">
            <label className="text-slate-400 text-xs">{label}</label>
            <div className="flex items-center gap-2">
                <select value={(value || '').split(':')[0]} disabled={!isEditing}
                    onChange={(e) => onChange(e.target.value + ':' + ((value || '').split(':')[1] || ''))}
                    className={`px-2 py-2 border rounded text-xs w-24 ${!isEditing ? 'bg-slate-700/30 border-slate-700/50 text-slate-400' : 'bg-slate-800/50 border-slate-600/50 text-white'}`}
                >
                    <option value="Modbus">Modbus</option>
                    <option value="Manual">Manual</option>
                </select>
                <input value={(value || '').split(':')[1] || ''} disabled={!isEditing}
                    onChange={(e) => onChange((value || '').split(':')[0] + ':' + e.target.value)}
                    placeholder="Address/Value"
                    className={`flex-1 px-2 py-2 border rounded text-xs ${!isEditing ? 'bg-slate-700/30 border-slate-700/50 text-slate-400' : 'bg-slate-800/50 border-slate-600/50 text-white'}`}
                />
            </div>
        </div>
    );

    return (
        <div className="min-h-screen p-6">
            <ConfigHeader
                title="Equipment Specifications"
                description={`Configure ${unitId} compressor and engine parameters`}
                isEditing={isEditing}
                onEditToggle={() => setIsEditing(!isEditing)}
                onSave={handleSave}
            />

            {saveStatus === 'success' && (
                <div className="mb-4 p-3 bg-green-500/20 border border-green-500/50 rounded-lg text-green-400 text-sm">
                    ✓ Configuration saved successfully
                </div>
            )}
            {saveStatus === 'error' && (
                <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
                    ✗ Failed to save configuration
                </div>
            )}

            <div className="flex gap-2 mb-6">
                {(['compressor', 'engine'] as const).map((tab) => (
                    <button key={tab} onClick={() => setActiveTab(tab)}
                        className={`px-6 py-3 rounded-lg font-medium transition-all ${activeTab === tab ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/50'
                                : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700/50'}`}>
                        {tab === 'compressor' ? '⚙️ Compressor' : '🔧 Engine'}
                    </button>
                ))}
            </div>

            {activeTab === 'compressor' && (
                <div className="space-y-6">
                    <div className="glass-card p-6">
                        <h2 className="text-xl font-semibold text-white mb-4">General Information</h2>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <InputField label="Manufacturer" value={compressor.manufacturer} onChange={(v: string) => setCompressor({ ...compressor, manufacturer: v })} />
                            <InputField label="Model" value={compressor.model} onChange={(v: string) => setCompressor({ ...compressor, model: v })} />
                            <InputField label="Serial Number" value={compressor.serialNumber} onChange={(v: string) => setCompressor({ ...compressor, serialNumber: v })} />
                            <SelectField label="Type" value={compressor.compressorType} options={['Reciprocating', 'Screw', 'Centrifugal']} onChange={(v: string) => setCompressor({ ...compressor, compressorType: v })} />
                            <InputField label="Stages" value={compressor.numStages} onChange={(v: number) => setCompressor({ ...compressor, numStages: v })} type="number" />
                            <InputField label="Frame Rating" value={compressor.frameRatingHP} onChange={(v: number) => setCompressor({ ...compressor, frameRatingHP: v })} type="number" unit="HP" />
                            <InputField label="Max Rod Load" value={compressor.maxRodLoad} onChange={(v: number) => setCompressor({ ...compressor, maxRodLoad: v })} type="number" unit="lbf" />
                        </div>
                    </div>

                    <div className="glass-card p-6">
                        <h2 className="text-xl font-semibold text-white mb-4">Per-Stage Configuration</h2>
                        <div className="flex gap-2 mb-4">
                            {compressor.stages.map((_, i) => (
                                <button key={i} onClick={() => setActiveStage(i)}
                                    className={`px-4 py-2 rounded-lg text-sm font-medium ${activeStage === i ? 'bg-blue-500/20 text-blue-400 border border-blue-500/50'
                                            : 'bg-slate-800/50 text-slate-400'}`}>
                                    Stage {i + 1}
                                </button>
                            ))}
                        </div>
                        {compressor.stages[activeStage] && (
                            <div className="space-y-6">
                                <div>
                                    <h3 className="text-sm font-medium text-slate-300 mb-3 border-b border-slate-700/50 pb-2">Cylinder Geometry</h3>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                        <InputField label="Cylinders" value={compressor.stages[activeStage].cylinders} onChange={(v: number) => updateStage(activeStage, 'cylinders', v)} type="number" />
                                        <SelectField label="Action" value={compressor.stages[activeStage].action} options={['double_acting', 'single_acting']} onChange={(v: string) => updateStage(activeStage, 'action', v)} />
                                        <InputField label="Bore" value={compressor.stages[activeStage].boreDiameter} onChange={(v: number) => updateStage(activeStage, 'boreDiameter', v)} type="number" unit="in" />
                                        <InputField label="Stroke" value={compressor.stages[activeStage].strokeLength} onChange={(v: number) => updateStage(activeStage, 'strokeLength', v)} type="number" unit="in" />
                                        <InputField label="Rod Dia" value={compressor.stages[activeStage].rodDiameter} onChange={(v: number) => updateStage(activeStage, 'rodDiameter', v)} type="number" unit="in" />
                                        <InputField label="Clearance HE" value={compressor.stages[activeStage].clearanceHE} onChange={(v: number) => updateStage(activeStage, 'clearanceHE', v)} type="number" unit="%" />
                                        <InputField label="Clearance CE" value={compressor.stages[activeStage].clearanceCE} onChange={(v: number) => updateStage(activeStage, 'clearanceCE', v)} type="number" unit="%" />
                                    </div>
                                </div>
                                <div>
                                    <h3 className="text-sm font-medium text-slate-300 mb-3 border-b border-slate-700/50 pb-2">Design Conditions</h3>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                        <InputField label="Suction P" value={compressor.stages[activeStage].designSuctionPressure} onChange={(v: number) => updateStage(activeStage, 'designSuctionPressure', v)} type="number" unit="PSIG" />
                                        <InputField label="Discharge P" value={compressor.stages[activeStage].designDischargePressure} onChange={(v: number) => updateStage(activeStage, 'designDischargePressure', v)} type="number" unit="PSIG" />
                                        <InputField label="Suction T" value={compressor.stages[activeStage].designSuctionTemp} onChange={(v: number) => updateStage(activeStage, 'designSuctionTemp', v)} type="number" unit="°F" />
                                    </div>
                                </div>
                                <div>
                                    <h3 className="text-sm font-medium text-slate-300 mb-3 border-b border-slate-700/50 pb-2">Data Source Mapping</h3>
                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                        <SourceField label="Suction P" value={compressor.stages[activeStage].suctionPressSource} onChange={(v: string) => updateStage(activeStage, 'suctionPressSource', v)} />
                                        <SourceField label="Discharge P" value={compressor.stages[activeStage].dischargePressSource} onChange={(v: string) => updateStage(activeStage, 'dischargePressSource', v)} />
                                        <SourceField label="Suction T" value={compressor.stages[activeStage].suctionTempSource} onChange={(v: string) => updateStage(activeStage, 'suctionTempSource', v)} />
                                        <SourceField label="Discharge T" value={compressor.stages[activeStage].dischargeTempSource} onChange={(v: string) => updateStage(activeStage, 'dischargeTempSource', v)} />
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'engine' && (
                <div className="space-y-6">
                    <div className="glass-card p-6">
                        <h2 className="text-xl font-semibold text-white mb-4">General Information</h2>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <InputField label="Manufacturer" value={engine.manufacturer} onChange={(v: string) => setEngine({ ...engine, manufacturer: v })} />
                            <InputField label="Model" value={engine.model} onChange={(v: string) => setEngine({ ...engine, model: v })} />
                            <InputField label="Serial" value={engine.serialNumber} onChange={(v: string) => setEngine({ ...engine, serialNumber: v })} />
                            <SelectField label="Fuel" value={engine.fuelType} options={['Natural Gas', 'Diesel', 'Dual Fuel']} onChange={(v: string) => setEngine({ ...engine, fuelType: v })} />
                        </div>
                    </div>
                    <div className="glass-card p-6">
                        <h2 className="text-xl font-semibold text-white mb-4">Engine Specs</h2>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <InputField label="Cylinders" value={engine.numCylinders} onChange={(v: number) => setEngine({ ...engine, numCylinders: v })} type="number" />
                            <SelectField label="Config" value={engine.configuration} options={['V', 'inline']} onChange={(v: string) => setEngine({ ...engine, configuration: v as any })} />
                            <InputField label="Bore" value={engine.bore} onChange={(v: number) => setEngine({ ...engine, bore: v })} type="number" unit="in" />
                            <InputField label="Stroke" value={engine.stroke} onChange={(v: number) => setEngine({ ...engine, stroke: v })} type="number" unit="in" />
                            <InputField label="Rated BHP" value={engine.ratedBHP} onChange={(v: number) => setEngine({ ...engine, ratedBHP: v })} type="number" unit="HP" />
                            <InputField label="Rated RPM" value={engine.ratedRPM} onChange={(v: number) => setEngine({ ...engine, ratedRPM: v })} type="number" unit="RPM" />
                        </div>
                        <div className="flex gap-6 mt-4">
                            <label className="flex items-center gap-2 text-slate-300 text-sm">
                                <input type="checkbox" checked={engine.turbo} disabled={!isEditing}
                                    onChange={(e) => setEngine({ ...engine, turbo: e.target.checked })}
                                    className={`w-4 h-4 rounded border-slate-600 ${!isEditing ? 'opacity-50' : ''}`}
                                />
                                Turbocharged
                            </label>
                            <label className="flex items-center gap-2 text-slate-300 text-sm">
                                <input type="checkbox" checked={engine.intercooled} disabled={!isEditing}
                                    onChange={(e) => setEngine({ ...engine, intercooled: e.target.checked })}
                                    className={`w-4 h-4 rounded border-slate-600 ${!isEditing ? 'opacity-50' : ''}`}
                                />
                                Intercooled
                            </label>
                        </div>
                    </div>
                    <div className="glass-card p-6">
                        <h2 className="text-xl font-semibold text-white mb-4">Coupling</h2>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <SelectField label="Type" value={engine.couplingType} options={['Direct', 'Geared', 'Belt']} onChange={(v: string) => setEngine({ ...engine, couplingType: v })} />
                            <InputField label="Speed Ratio" value={engine.speedRatio} onChange={(v: string) => setEngine({ ...engine, speedRatio: v })} />
                            <InputField label="Mech Eff" value={engine.mechEfficiency} onChange={(v: number) => setEngine({ ...engine, mechEfficiency: v })} type="number" unit="%" />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
