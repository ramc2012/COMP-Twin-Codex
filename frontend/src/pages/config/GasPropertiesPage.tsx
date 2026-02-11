/**
 * Gas Properties Page
 * Configure gas composition and thermodynamic properties.
 */
import { useState, useEffect } from 'react';
import { ConfigHeader } from '../../components/ConfigHeader';
import { useUnit } from '../../contexts/UnitContext';
import { fetchGasConfig, saveGasConfig } from '../../lib/api';

export function GasPropertiesPage() {
    const { unitId } = useUnit();
    const [isEditing, setIsEditing] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');

    const [gas, setGas] = useState({
        name: 'Natural Gas',
        specific_gravity: 0.65,
        k_suction: 1.28,
        k_discharge: 1.25,
        z_suction: 0.98,
        z_discharge: 0.95
    });

    useEffect(() => {
        loadConfig();
    }, [unitId]);

    const loadConfig = async () => {
        try {
            const data = await fetchGasConfig(unitId);
            setGas(data);
        } catch (e) {
            console.error('Failed to load gas config:', e);
        }
    };

    const handleSave = async () => {
        setSaveStatus('idle');
        try {
            await saveGasConfig(unitId, gas);
            setSaveStatus('success');
            setIsEditing(false);
            setTimeout(() => setSaveStatus('idle'), 3000);
        } catch (e) {
            setSaveStatus('error');
            console.error('Save failed:', e);
        }
    };

    const InputField = ({ label, value, field, unit, type = 'number', step = 0.01 }: any) => (
        <div className="flex flex-col gap-1">
            <label className="text-slate-400 text-xs">{label}</label>
            <div className="flex items-center gap-2">
                <input
                    type={type}
                    step={step}
                    value={value}
                    disabled={!isEditing}
                    onChange={(e) => setGas({ ...gas, [field]: type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value })}
                    className={`w-full px-3 py-2 border rounded text-sm focus:outline-none focus:border-cyan-500/50 ${!isEditing ? 'bg-slate-700/30 border-slate-700/50 text-slate-400' : 'bg-slate-800/50 border-slate-600/50 text-white'
                        }`}
                />
                {unit && <span className="text-slate-400 text-xs">{unit}</span>}
            </div>
        </div>
    );

    return (
        <div className="min-h-screen p-6">
            <ConfigHeader
                title="Gas Properties"
                description={`Configure gas composition for ${unitId}`}
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="glass-card p-6">
                    <h2 className="text-xl font-semibold text-white mb-4">Gas Composition</h2>
                    <div className="space-y-4">
                        <InputField label="Profile Name" value={gas.name} field="name" type="text" />
                        <InputField label="Specific Gravity (SG)" value={gas.specific_gravity} field="specific_gravity" />
                    </div>
                </div>

                <div className="glass-card p-6">
                    <h2 className="text-xl font-semibold text-white mb-4">Thermodynamic Properties</h2>
                    <div className="grid grid-cols-2 gap-4">
                        <InputField label="k (Suction)" value={gas.k_suction} field="k_suction" />
                        <InputField label="k (Discharge)" value={gas.k_discharge} field="k_discharge" />
                        <InputField label="Z (Suction)" value={gas.z_suction} field="z_suction" />
                        <InputField label="Z (Discharge)" value={gas.z_discharge} field="z_discharge" />
                    </div>
                    <p className="mt-4 text-xs text-slate-500">
                        * Used for calculating adiabatic head and efficiency.
                    </p>
                </div>
            </div>
        </div>
    );
}
