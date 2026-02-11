import { useState, useEffect } from 'react';
import { useUnit } from '../../contexts/UnitContext';
import { ConfigHeader } from '../../components/ConfigHeader';
import { 
    fetchSiteConditions, 
    updateSiteConditions, 
    fetchDerating,
    type SiteConditions 
} from '../../lib/api';

export function SiteConditionsPage() {
    const { unitId } = useUnit();
    const [isEditing, setIsEditing] = useState(false);
    const [loading, setLoading] = useState(true);
    const [derating, setDerating] = useState<any>(null);
    const [error, setError] = useState<string | null>(null);
    
    const [conditions, setConditions] = useState<SiteConditions>({
        elevation_ft: 0,
        barometric_psi: 14.7,
        ambient_temp_f: 75,
        design_ambient_f: 95,
        cooler_approach_f: 15,
        humidity_pct: 50
    });

    useEffect(() => {
        loadData();
    }, [unitId]);

    const loadData = async () => {
        try {
            setLoading(true);
            const [siteData, deratingData] = await Promise.all([
                fetchSiteConditions(unitId),
                fetchDerating(unitId)
            ]);
            
            if (siteData.site_conditions) {
                setConditions(siteData.site_conditions);
            }
            setDerating(deratingData);
            setError(null);
        } catch (e: any) {
            console.error('Failed to load site conditions:', e);
            setError('Failed to load site conditions. Using defaults.');
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        try {
            await updateSiteConditions(unitId, conditions);
            setIsEditing(false);
            // Reload to get updated derating
            loadData();
        } catch (e: any) {
            console.error('Failed to save site conditions:', e);
            setError('Failed to save changes');
        }
    };

    const calculateBaro = (elev: number) => {
        // Simplified formula: P = 14.696 * (1 - 6.8754e-6 * h)^5.2561
        const p = 14.696 * Math.pow(1 - 6.8754e-6 * elev, 5.2561);
        setConditions(prev => ({ 
            ...prev, 
            elevation_ft: elev, 
            barometric_psi: parseFloat(p.toFixed(2)) 
        }));
    };

    const InputField = ({ label, value, onChange, unit = '', type = 'number', readOnly = false }: any) => (
        <div className="flex flex-col gap-1">
            <label className="text-slate-400 text-xs">{label}</label>
            <div className="flex items-center gap-2">
                <input
                    type={type}
                    value={value}
                    disabled={!isEditing && !readOnly}
                    readOnly={readOnly}
                    onChange={(e) => onChange(type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)}
                    className={`w-full px-3 py-2 border rounded text-sm focus:outline-none focus:border-cyan-500/50 ${
                        !isEditing || readOnly
                            ? 'bg-slate-700/30 border-slate-700/50 text-slate-400' 
                            : 'bg-slate-800/50 border-slate-600/50 text-white'
                    }`}
                />
                {unit && <span className="text-slate-400 text-xs whitespace-nowrap">{unit}</span>}
            </div>
        </div>
    );

    if (loading) {
        return <div className="p-8 text-center text-slate-400">Loading site conditions...</div>;
    }

    return (
        <div className="min-h-screen p-6">
            <ConfigHeader 
                title="Site Conditions" 
                description={`Configure location parameters for ${unitId}`}
                isEditing={isEditing}
                onEditToggle={() => setIsEditing(!isEditing)}
                onSave={handleSave}
            />

            {error && (
                <div className="mb-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400">
                    {error}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Atmospheric Conditions */}
                <div className="glass-card p-6">
                    <h2 className="text-xl font-semibold text-white mb-4">Atmospheric Conditions</h2>
                    <div className="space-y-4">
                        <div className="flex flex-col gap-1">
                            <label className="text-slate-400 text-xs">Site Elevation</label>
                            <div className="flex items-center gap-2">
                                <input
                                    type="number"
                                    value={conditions.elevation_ft}
                                    disabled={!isEditing}
                                    onChange={(e) => calculateBaro(parseFloat(e.target.value) || 0)}
                                    className={`w-full px-3 py-2 border rounded text-sm focus:outline-none focus:border-cyan-500/50 ${
                                        !isEditing
                                            ? 'bg-slate-700/30 border-slate-700/50 text-slate-400' 
                                            : 'bg-slate-800/50 border-slate-600/50 text-white'
                                    }`}
                                />
                                <span className="text-slate-400 text-xs">ft</span>
                            </div>
                        </div>

                        <InputField 
                            label="Barometric Pressure" 
                            value={conditions.barometric_psi} 
                            onChange={(v: number) => setConditions({...conditions, barometric_psi: v})} 
                            unit="PSIA" 
                        />

                        <InputField 
                            label="Ambient Temperature" 
                            value={conditions.ambient_temp_f} 
                            onChange={(v: number) => setConditions({...conditions, ambient_temp_f: v})} 
                            unit="°F" 
                        />

                        <div className="mt-4 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                            <div className="text-xs text-blue-300 mb-1">Impact</div>
                            <p className="text-sm text-slate-300">
                                Barometric pressure affects engine derating and compressor volumetric efficiency.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Design & Cooling */}
                <div className="glass-card p-6">
                    <h2 className="text-xl font-semibold text-white mb-4">Design & Cooling</h2>
                    <div className="space-y-4">
                        <InputField 
                            label="Design Ambient Temp" 
                            value={conditions.design_ambient_f} 
                            onChange={(v: number) => setConditions({...conditions, design_ambient_f: v})} 
                            unit="°F" 
                        />

                        <InputField 
                            label="Cooler Approach Temp" 
                            value={conditions.cooler_approach_f} 
                            onChange={(v: number) => setConditions({...conditions, cooler_approach_f: v})} 
                            unit="°F" 
                        />

                        <InputField 
                            label="Relative Humidity" 
                            value={conditions.humidity_pct} 
                            onChange={(v: number) => setConditions({...conditions, humidity_pct: v})} 
                            unit="%" 
                        />
                    </div>
                </div>

                {/* Derating Calculations */}
                {derating && (
                    <div className="glass-card p-6 md:col-span-2">
                        <h2 className="text-xl font-semibold text-white mb-4">Power Derating Factors</h2>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700/50 text-center">
                                <div className="text-xs text-slate-400 mb-1">Altitude Factor</div>
                                <div className="text-2xl font-bold text-cyan-400">{derating.altitude_derating}%</div>
                                <div className="text-xs text-slate-500 mt-1">Based on {conditions.elevation_ft} ft</div>
                            </div>
                            <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700/50 text-center">
                                <div className="text-xs text-slate-400 mb-1">Temperature Factor</div>
                                <div className="text-2xl font-bold text-orange-400">{derating.temperature_derating}%</div>
                                <div className="text-xs text-slate-500 mt-1">Based on {conditions.ambient_temp_f}°F</div>
                            </div>
                            <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700/50 text-center">
                                <div className="text-xs text-slate-400 mb-1">Combined Derating</div>
                                <div className="text-2xl font-bold text-emerald-400">{derating.combined_derating}%</div>
                                <div className="text-xs text-slate-500 mt-1">Total power availability</div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
