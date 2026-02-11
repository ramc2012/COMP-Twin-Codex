/**
 * Layout Component - Main app shell with sidebar navigation
 * Updated with UnitSelector for Phase 5
 */
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { UnitSelector } from './UnitSelector';
import { useUnit } from '../contexts/UnitContext';

interface LayoutProps {
    children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
    const user = useAuthStore((state) => state.user);
    const logout = useAuthStore((state) => state.logout);
    const { activeUnit, unitId, units, pollIntervalMs, setPollIntervalMs } = useUnit();
    const location = useLocation();
    const navigate = useNavigate();
    const packageBase = `/packages/${activeUnit?.unit_id || unitId || 'GCS-001'}`;
    const [collapsed, setCollapsed] = useState<boolean>(() => localStorage.getItem('gcp_sidebar_collapsed') === '1');
    const [configExpanded, setConfigExpanded] = useState<boolean>(true);

    useEffect(() => {
        localStorage.setItem('gcp_sidebar_collapsed', collapsed ? '1' : '0');
    }, [collapsed]);

    useEffect(() => {
        if (location.pathname.includes('/config')) {
            setConfigExpanded(true);
        }
    }, [location.pathname]);

    const navItems = useMemo(() => ([
        { path: '/', label: 'Overview', icon: '🏠', end: true },
        { path: `${packageBase}/dashboard`, label: 'Dashboard', icon: '📊' },
        { path: `${packageBase}/compressor`, label: 'Compressor', icon: '🔄' },
        { path: `${packageBase}/engine`, label: 'Engine', icon: '🔧' },
        { path: `${packageBase}/performance`, label: 'Performance', icon: '🧠' },
        { path: `${packageBase}/trending`, label: 'Trending', icon: '📉' },
        { path: `${packageBase}/diagrams`, label: 'Diagrams', icon: '📈' },
        { path: `${packageBase}/alarms`, label: 'Alarms', icon: '🔔' },
        { path: `${packageBase}/simulator`, label: 'Simulator', icon: '🎮' },
    ]), [packageBase]);

    const configItems = useMemo(() => {
        if (!units.length) {
            return [{
                path: `${packageBase}/config`,
                label: 'Package 1',
                unitId: activeUnit?.unit_id || unitId || 'GCS-001'
            }];
        }
        return units.map((unit, index) => ({
            path: `/packages/${unit.unit_id}/config`,
            label: `Package ${index + 1}`,
            unitId: unit.unit_id
        }));
    }, [units, packageBase, activeUnit?.unit_id, unitId]);

    const configActive = location.pathname.startsWith(`${packageBase}/config`);

    return (
        <div className="flex min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
            {/* Sidebar */}
            <aside className={`${collapsed ? 'w-20' : 'w-72'} bg-slate-900/80 backdrop-blur-lg border-r border-slate-700/50 flex flex-col transition-all duration-200`}>
                {/* Logo */}
                <div className="p-4 border-b border-slate-700/50">
                    <div className="flex items-center justify-between">
                        <div className={`flex items-center ${collapsed ? 'justify-center w-full' : 'gap-3'}`}>
                        <div className="text-3xl">⚡</div>
                            {!collapsed && (
                                <div>
                                    <h1 className="text-xl font-bold text-white">GCP MOTWAN</h1>
                                    <p className="text-xs text-slate-400">Compressor Platform</p>
                                </div>
                            )}
                        </div>
                        {!collapsed && (
                            <button
                                type="button"
                                onClick={() => setCollapsed(true)}
                                className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                                title="Minimize menu"
                            >
                                ◀
                            </button>
                        )}
                    </div>
                    {collapsed && (
                        <button
                            type="button"
                            onClick={() => setCollapsed(false)}
                            className="mt-2 w-full rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
                            title="Expand menu"
                        >
                            ▶
                        </button>
                    )}
                </div>

                {/* Navigation */}
                <nav className="flex-1 p-4">
                    <ul className="space-y-2">
                        {navItems.map((item) => (
                            <li key={item.path}>
                                <NavLink
                                    to={item.path}
                                    end={(item as any).end}
                                    className={({ isActive }) =>
                                        `flex items-center ${collapsed ? 'justify-center' : 'gap-3'} px-4 py-3 rounded-lg transition-all ${isActive
                                            ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                                            : 'text-slate-400 hover:bg-slate-800/50 hover:text-white'
                                        }`
                                    }
                                    title={collapsed ? item.label : undefined}
                                >
                                    <span className="text-xl">{item.icon}</span>
                                    {!collapsed && <span className="font-medium">{item.label}</span>}
                                </NavLink>
                            </li>
                        ))}
                        <li>
                            <button
                                type="button"
                                onClick={() => {
                                    if (collapsed) {
                                        setCollapsed(false);
                                        navigate(`${packageBase}/config`);
                                        return;
                                    }
                                    setConfigExpanded((v) => !v);
                                }}
                                className={`w-full flex items-center justify-between px-4 py-3 rounded-lg transition-all ${
                                    configActive
                                        ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                                        : 'text-slate-400 hover:bg-slate-800/50 hover:text-white'
                                }`}
                            >
                                <span className="flex items-center gap-3">
                                    <span className="text-xl">⚙️</span>
                                    {!collapsed && <span className="font-medium">Configuration</span>}
                                </span>
                                {!collapsed && <span className="text-xs">{configExpanded ? '▾' : '▸'}</span>}
                            </button>
                            {!collapsed && configExpanded && (
                                <div className="mt-1 ml-3 border-l border-slate-700/60 pl-3 space-y-1">
                                    {configItems.map((item) => (
                                        <NavLink
                                            key={item.unitId}
                                            to={item.path}
                                            className={({ isActive }) =>
                                                `block rounded-md px-3 py-2 text-sm transition-all ${
                                                    isActive
                                                        ? 'bg-cyan-500/15 text-cyan-300'
                                                        : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                                                }`
                                            }
                                        >
                                            <div className="font-medium">{item.label}</div>
                                            <div className="text-[11px] opacity-80">{item.unitId}</div>
                                        </NavLink>
                                    ))}
                                </div>
                            )}
                        </li>
                    </ul>
                </nav>

                {/* Unit Status / Selector */}
                {!collapsed && (
                    <div className="p-4 border-t border-slate-700/50">
                    <div className="bg-slate-800/50 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-slate-400 text-sm">Compressor Packages</span>
                            <span className={`text-xs flex items-center gap-1 ${activeUnit?.is_active ? 'text-green-400' : 'text-slate-500'}`}>
                                <span className={`w-2 h-2 rounded-full ${activeUnit?.is_active ? 'bg-green-400 animate-pulse' : 'bg-slate-500'}`}></span>
                                {activeUnit?.is_active ? 'Online' : 'Offline'}
                            </span>
                        </div>
                        {activeUnit && (
                            <div className="mb-2 text-xs text-slate-400">
                                Active: <span className="text-slate-200">{activeUnit.unit_id}</span> ({activeUnit.stage_count} stages)
                            </div>
                        )}
                        <div className="mb-2">
                            <UnitSelector />
                        </div>
                        <div className="mb-2">
                            <label className="block text-[11px] text-slate-400 mb-1">App Polling</label>
                            <select
                                value={String(pollIntervalMs)}
                                onChange={(e) => setPollIntervalMs(Number(e.target.value))}
                                className="w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                            >
                                <option value="1000">1 second</option>
                                <option value="2000">2 seconds (Default)</option>
                                <option value="5000">5 seconds</option>
                                <option value="10000">10 seconds</option>
                                <option value="15000">15 seconds</option>
                                <option value="30000">30 seconds</option>
                            </select>
                        </div>
                        <div className="text-slate-400 text-xs text-center">
                            Individual settings are scoped per package
                        </div>
                    </div>
                </div>
                )}

                {/* User Info */}
                <div className="p-4 border-t border-slate-700/50">
                    {user ? (
                        collapsed ? (
                            <button onClick={logout} className="w-full text-slate-300 text-xs rounded-md border border-slate-700 py-2 hover:bg-slate-800">
                                Logout
                            </button>
                        ) : (
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="text-white text-sm font-medium">{user.full_name}</div>
                                    <div className="text-slate-400 text-xs capitalize">{user.role}</div>
                                </div>
                                <button
                                    onClick={logout}
                                    className="text-slate-400 hover:text-white text-sm"
                                >
                                    Logout
                                </button>
                            </div>
                        )
                    ) : (
                        <NavLink
                            to="/login"
                            className={`block text-center py-2 px-4 bg-cyan-500/20 text-cyan-400 rounded-lg hover:bg-cyan-500/30 transition-colors ${collapsed ? 'text-xs' : ''}`}
                        >
                            Sign In
                        </NavLink>
                    )}
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 overflow-auto">
                {children}
            </main>
        </div>
    );
}
