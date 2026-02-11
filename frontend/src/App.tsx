/**
 * GCS Digital Twin - Main Application with Full Routing
 * Updated: Added AlarmConfigPage route
 */
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom';
import { lazy, Suspense, useEffect } from 'react';
import { Layout } from './components/Layout';
import { UnitProvider, useUnit } from './contexts/UnitContext';
import './index.css';

const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const CompressorPage = lazy(() => import('./pages/CompressorPage').then((m) => ({ default: m.CompressorPage })));
const EnginePage = lazy(() => import('./pages/EnginePage').then((m) => ({ default: m.EnginePage })));
const PerformancePage = lazy(() => import('./pages/PerformancePage').then((m) => ({ default: m.PerformancePage })));
const DiagramsPage = lazy(() => import('./pages/DiagramsPage').then((m) => ({ default: m.DiagramsPage })));
const AlarmsPage = lazy(() => import('./pages/AlarmsPage').then((m) => ({ default: m.AlarmsPage })));
const TrendingPage = lazy(() => import('./pages/TrendingPage').then((m) => ({ default: m.TrendingPage })));
const ConfigPage = lazy(() => import('./pages/ConfigPage').then((m) => ({ default: m.ConfigPage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const SimulatorDashboard = lazy(() => import('./pages/SimulatorDashboard').then((m) => ({ default: m.SimulatorDashboard })));
const EquipmentSpecsPage = lazy(() => import('./pages/config/EquipmentSpecsPage').then((m) => ({ default: m.EquipmentSpecsPage })));
const GasPropertiesPage = lazy(() => import('./pages/config/GasPropertiesPage').then((m) => ({ default: m.GasPropertiesPage })));
const SiteConditionsPage = lazy(() => import('./pages/config/SiteConditionsPage').then((m) => ({ default: m.SiteConditionsPage })));
const ModbusMappingPage = lazy(() => import('./pages/config/ModbusMappingPage').then((m) => ({ default: m.ModbusMappingPage })));
const UserManagementPage = lazy(() => import('./pages/config/UserManagementPage').then((m) => ({ default: m.UserManagementPage })));
const AlarmConfigPage = lazy(() => import('./pages/AlarmConfigPage').then((m) => ({ default: m.AlarmConfigPage })));
const PackagesOverviewPage = lazy(() => import('./pages/PackagesOverviewPage').then((m) => ({ default: m.PackagesOverviewPage })));

function PageLoader() {
    return (
        <div className="min-h-screen flex items-center justify-center text-slate-300">
            Loading page...
        </div>
    );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
    // For demo, we allow access but in production we'd redirect to login
    return <>{children}</>;
}

function PackageWorkspace() {
    const { packageId } = useParams();
    const navigate = useNavigate();
    const { setUnitId, units, loading } = useUnit();

    useEffect(() => {
        if (packageId) setUnitId(packageId);
    }, [packageId, setUnitId]);

    useEffect(() => {
        if (!loading && packageId && !units.some((u) => u.unit_id === packageId)) {
            navigate('/', { replace: true });
        }
    }, [loading, packageId, units, navigate]);

    if (!packageId) return <Navigate to="/" replace />;

    return (
        <Layout>
            <Suspense fallback={<PageLoader />}>
                <Routes>
                    <Route index element={<Navigate to="dashboard" replace />} />
                    <Route path="dashboard" element={<Dashboard />} />
                    <Route path="compressor" element={<CompressorPage />} />
                    <Route path="engine" element={<EnginePage />} />
                    <Route path="performance" element={<PerformancePage />} />
                    <Route path="trending" element={<TrendingPage />} />
                    <Route path="diagrams" element={<DiagramsPage />} />
                    <Route path="alarms" element={<AlarmsPage />} />
                    <Route path="config" element={<ConfigPage />} />
                    <Route path="config/equipment" element={<EquipmentSpecsPage />} />
                    <Route path="config/gas" element={<GasPropertiesPage />} />
                    <Route path="config/site" element={<SiteConditionsPage />} />
                    <Route path="config/modbus" element={<ModbusMappingPage />} />
                    <Route path="config/users" element={<UserManagementPage />} />
                    <Route path="config/alarms" element={<AlarmConfigPage />} />
                    <Route path="simulator" element={<SimulatorDashboard />} />
                    <Route path="*" element={<Navigate to="dashboard" replace />} />
                </Routes>
            </Suspense>
        </Layout>
    );
}

function OverviewWorkspace() {
    return (
        <Layout>
            <Suspense fallback={<PageLoader />}>
                <PackagesOverviewPage />
            </Suspense>
        </Layout>
    );
}

function App() {
    return (
        <BrowserRouter>
            <UnitProvider>
                <Routes>
                    <Route
                        path="/login"
                        element={(
                            <Suspense fallback={<PageLoader />}>
                                <LoginPage />
                            </Suspense>
                        )}
                    />
                    <Route path="/" element={<ProtectedRoute><OverviewWorkspace /></ProtectedRoute>} />
                    <Route path="/packages/:packageId/*" element={<ProtectedRoute><PackageWorkspace /></ProtectedRoute>} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </UnitProvider>
        </BrowserRouter>
    );
}

export default App;
