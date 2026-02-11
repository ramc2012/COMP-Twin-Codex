/**
 * GCS Digital Twin - Main Application with Full Routing
 * Updated: Added AlarmConfigPage route
 */
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom';
import { useEffect } from 'react';
import { Layout } from './components/Layout';
import { UnitProvider, useUnit } from './contexts/UnitContext';
import { Dashboard } from './pages/Dashboard';
import { CompressorPage } from './pages/CompressorPage';
import { EnginePage } from './pages/EnginePage';
import { DiagramsPage } from './pages/DiagramsPage';
import { AlarmsPage } from './pages/AlarmsPage';
import { TrendingPage } from './pages/TrendingPage';
import { ConfigPage } from './pages/ConfigPage';
import { LoginPage } from './pages/LoginPage';
import { SimulatorDashboard } from './pages/SimulatorDashboard';
import { EquipmentSpecsPage } from './pages/config/EquipmentSpecsPage';
import { GasPropertiesPage } from './pages/config/GasPropertiesPage';
import { SiteConditionsPage } from './pages/config/SiteConditionsPage';
import { ModbusMappingPage } from './pages/config/ModbusMappingPage';
import { UserManagementPage } from './pages/config/UserManagementPage';
import { AlarmConfigPage } from './pages/AlarmConfigPage';
import { PackagesOverviewPage } from './pages/PackagesOverviewPage';
import './index.css';

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
            <Routes>
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<Dashboard />} />
                <Route path="compressor" element={<CompressorPage />} />
                <Route path="engine" element={<EnginePage />} />
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
        </Layout>
    );
}

function OverviewWorkspace() {
    return (
        <Layout>
            <PackagesOverviewPage />
        </Layout>
    );
}

function App() {
    return (
        <BrowserRouter>
            <UnitProvider>
                <Routes>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/" element={<ProtectedRoute><OverviewWorkspace /></ProtectedRoute>} />
                    <Route path="/packages/:packageId/*" element={<ProtectedRoute><PackageWorkspace /></ProtectedRoute>} />
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </UnitProvider>
        </BrowserRouter>
    );
}

export default App;
