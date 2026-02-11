import { useNavigate } from 'react-router-dom';
import { useUnit } from '../contexts/UnitContext';

interface ConfigHeaderProps {
    title: string;
    description: string;
    isEditing: boolean;
    onEditToggle: () => void;
    onSave?: () => void;
    canEdit?: boolean;
    isSaving?: boolean;
}

export function ConfigHeader({
    title,
    description,
    isEditing,
    onEditToggle,
    onSave,
    canEdit = true,
    isSaving = false
}: ConfigHeaderProps) {
    const navigate = useNavigate();
    const { unitId, activeUnit, units } = useUnit();
    const packageIndex = Math.max(0, units.findIndex((u) => u.unit_id === unitId));
    const packageTone = [
        'border-cyan-500/35 bg-cyan-500/10 text-cyan-200',
        'border-emerald-500/35 bg-emerald-500/10 text-emerald-200',
        'border-amber-500/35 bg-amber-500/10 text-amber-200',
        'border-violet-500/35 bg-violet-500/10 text-violet-200',
        'border-rose-500/35 bg-rose-500/10 text-rose-200'
    ][packageIndex % 5];

    return (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-4 border-b border-white/10">
            <div className="flex items-start gap-4">
                <button
                    onClick={() => navigate(`/packages/${unitId}/config`)}
                    className="mt-1 p-2 rounded-lg bg-slate-800/50 hover:bg-slate-700/50 text-slate-400 hover:text-white transition-all"
                    title="Back to Configuration"
                >
                    ←
                </button>
                <div>
                    <div className="flex items-center gap-3">
                        <h1 className="text-3xl font-bold text-white">{title}</h1>
                        {isEditing && (
                            <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 text-xs font-medium rounded border border-amber-500/30 animate-pulse">
                                EDITING
                            </span>
                        )}
                    </div>
                    <p className="text-slate-400">{description}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className={`px-2.5 py-1 rounded-md border text-[11px] font-semibold tracking-wide ${packageTone}`}>
                            Package Scope: {unitId}
                        </span>
                        <span className="px-2.5 py-1 rounded-md border border-slate-700/80 bg-slate-900/60 text-[11px] text-slate-300">
                            {activeUnit?.stage_count ?? 0} stages
                        </span>
                        <span className="px-2.5 py-1 rounded-md border border-slate-700/80 bg-slate-900/60 text-[11px] text-slate-400">
                            Settings are isolated per package
                        </span>
                    </div>
                </div>
            </div>

            {canEdit && (
                <div className="flex items-center gap-3">
                    {isEditing ? (
                        <>
                            <button
                                onClick={onEditToggle}
                                disabled={isSaving}
                                className="px-4 py-2 bg-slate-700/50 hover:bg-slate-600/50 text-white rounded-lg transition-all disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={onSave}
                                disabled={isSaving}
                                className="px-6 py-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-medium rounded-lg hover:from-green-600 hover:to-emerald-700 shadow-lg shadow-green-500/20 transition-all disabled:opacity-50 flex items-center gap-2"
                            >
                                {isSaving ? (
                                    <>
                                        <span className="animate-spin">⏳</span>
                                        Saving...
                                    </>
                                ) : (
                                    'Save Changes'
                                )}
                            </button>
                        </>
                    ) : (
                        <button
                            onClick={onEditToggle}
                            className="px-4 py-2 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded-lg transition-all flex items-center gap-2"
                        >
                            <span>✏️</span> Enable Edit
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
