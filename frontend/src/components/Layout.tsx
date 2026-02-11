/**
 * Layout Component - Main app shell with sidebar navigation
 * Updated with UnitSelector for Phase 5
 */
import { NavLink } from 'react-router-dom';
import { useAuthStore } from '../store/useAuthStore';
import { UnitSelector } from './UnitSelector';
import { useUnit } from '../contexts/UnitContext';

interface LayoutProps {
    children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
    const user = useAuthStore((state) => state.user);
    const logout = useAuthStore((state) => state.logout);
    const { activeUnit, unitId } = useUnit();
    const packageBase = `/packages/${activeUnit?.unit_id || unitId || 'GCS-001'}`;

    const navItems = [
        { path: '/', label: 'Overview', icon: '🏠', end: true },
        { path: `${packageBase}/dashboard`, label: 'Dashboard', icon: '📊' },
        { path: `${packageBase}/compressor`, label: 'Compressor', icon: '🔄' },
        { path: `${packageBase}/engine`, label: 'Engine', icon: '🔧' },
        { path: `${packageBase}/trending`, label: 'Trending', icon: '📉' },
        { path: `${packageBase}/diagrams`, label: 'Diagrams', icon: '📈' },
        { path: `${packageBase}/alarms`, label: 'Alarms', icon: '🔔' },
        { path: `${packageBase}/config`, label: 'Configuration', icon: '⚙️' },
        { path: `${packageBase}/simulator`, label: 'Simulator', icon: '🎮' },
    ];

    return (
        <div className="flex min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
            {/* Sidebar */}
            <aside className="w-64 bg-slate-900/80 backdrop-blur-lg border-r border-slate-700/50 flex flex-col">
                {/* Logo */}
                <div className="p-6 border-b border-slate-700/50">
                    <div className="flex items-center gap-3">
                        <div className="text-3xl">⚡</div>
                        <div>
                            <h1 className="text-xl font-bold text-white">GCS Digital Twin</h1>
                            <p className="text-xs text-slate-400">Universal Platform</p>
                        </div>
                    </div>
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
                                        `flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${isActive
                                            ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                                            : 'text-slate-400 hover:bg-slate-800/50 hover:text-white'
                                        }`
                                    }
                                >
                                    <span className="text-xl">{item.icon}</span>
                                    <span className="font-medium">{item.label}</span>
                                </NavLink>
                            </li>
                        ))}
                    </ul>
                </nav>

                {/* Unit Status / Selector */}
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
                        <div className="text-slate-400 text-xs text-center">
                            Individual settings are scoped per package
                        </div>
                    </div>
                </div>

                {/* User Info */}
                <div className="p-4 border-t border-slate-700/50">
                    {user ? (
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
                    ) : (
                        <NavLink
                            to="/login"
                            className="block text-center py-2 px-4 bg-cyan-500/20 text-cyan-400 rounded-lg hover:bg-cyan-500/30 transition-colors"
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
