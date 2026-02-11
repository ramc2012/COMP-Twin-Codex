/**
 * API client for communicating with the FastAPI backend
 * Enhanced for Phase 5+: Config persistence, multi-unit, alarms, trending, site conditions
 */

const API_BASE = '/api';
const WS_SCHEME = window.location.protocol === 'https:' ? 'wss' : 'ws';
const WS_ORIGIN = `${WS_SCHEME}://${window.location.host}`;

// ============ TYPES ============

export interface LiveDataResponse {
    unit_id: string;
    timestamp: string;
    sources?: Record<string, 'LIVE' | 'CALCULATED' | 'MANUAL' | 'DEFAULT' | 'BAD'>;
    [key: string]: any;
}

export interface UnitSummary {
    unit_id: string;
    name: string;
    stage_count: number;
    is_active: boolean;
    has_modbus: boolean;
}

export interface UnitCreateRequest {
    unit_id: string;
    name: string;
    stage_count: number;
    modbus_host?: string | null;
    modbus_port?: number;
    modbus_slave_id?: number;
    description?: string;
    location?: string;
}

export interface UnitUpdateRequest {
    name?: string;
    stage_count?: number;
    modbus_host?: string | null;
    modbus_port?: number;
    is_active?: boolean;
    description?: string;
    location?: string;
    tag?: string;
}

export interface EquipmentConfig {
    compressor: {
        manufacturer: string;
        model: string;
        serialNumber: string;
        numStages: number;
        compressorType: string;
        frameRatingHP: number;
        maxRodLoad: number;
        stages: StageConfig[];
    };
    engine: {
        manufacturer: string;
        model: string;
        fuelType: string;
        ratedBHP: number;
        ratedRPM: number;
    };
}

export interface StageConfig {
    cylinders: number;
    action: string;
    boreDiameter: number;
    strokeLength: number;
    rodDiameter: number;
    clearanceHE: number;
    clearanceCE: number;
    designSuctionPressure: number;
    designDischargePressure: number;
    designSuctionTemp: number;
    suctionPressSource?: string;
    dischargePressSource?: string;
    suctionTempSource?: string;
    dischargeTempSource?: string;
}

export interface AlarmActive {
    id: string;
    parameter: string;
    level: 'LL' | 'L' | 'H' | 'HH';
    value: number;
    setpoint: number;
    timestamp: string;
    acknowledged: boolean;
}

export interface TrendQuery {
    parameters: string[];
    start: string;
    end: string;
    aggregation?: '1s' | '1m' | '5m' | '1h';
}

export interface PerformanceTrendPoint {
    time: string;
    value: number;
}

// User Management Types
export interface User {
    username: string;
    role: 'admin' | 'engineer' | 'operator';
    full_name?: string;
    email?: string;
    is_active: boolean;
    created_at?: string;
}

// ============ AUTH ============

function readInitialAuthToken(): string | null {
    const directToken = localStorage.getItem('auth_token');
    if (directToken) return directToken;

    const persistedState = localStorage.getItem('gcs-auth-storage');
    if (!persistedState) return null;

    try {
        const parsed = JSON.parse(persistedState);
        return parsed?.state?.token ?? null;
    } catch {
        return null;
    }
}

export function setAuthToken(token: string | null) {
    if (token) {
        localStorage.setItem('auth_token', token);
    } else {
        localStorage.removeItem('auth_token');
    }
}

function getAuthToken(): string | null {
    // Always refresh from storage so APIs work even when login happened through another store module.
    return readInitialAuthToken();
}

async function getApiErrorMessage(response: Response, fallback: string): Promise<string> {
    try {
        const data = await response.json();
        if (typeof data?.detail === 'string') return data.detail;
        if (typeof data?.message === 'string') return data.message;
    } catch {
        // Ignore parse failures and use fallback
    }
    return fallback;
}

function authHeaders(): HeadersInit {
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    const token = getAuthToken();
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
}

export async function login(username: string, password: string): Promise<{ access_token: string; role: string }> {
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);

    const response = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData
    });
    if (!response.ok) throw new Error('Login failed');
    const data = await response.json();
    setAuthToken(data.access_token);
    return data;
}

export function logout() {
    setAuthToken(null);
}

// ============ USERS ============

export async function getUsers(): Promise<User[]> {
    const response = await fetch(`${API_BASE}/auth/users`, { headers: authHeaders() });
    if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to load users'));
    }
    return response.json();
}

export async function createUser(user: Partial<User> & { password: string }): Promise<User> {
    const response = await fetch(`${API_BASE}/auth/users`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(user)
    });
    if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to create user'));
    }
    return response.json();
}

export async function deleteUser(username: string): Promise<void> {
    const response = await fetch(`${API_BASE}/auth/users/${username}`, {
        method: 'DELETE',
        headers: authHeaders()
    });
    if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to delete user'));
    }
}

// ============ UNITS ============

export async function fetchUnits(): Promise<{ units: UnitSummary[]; count: number }> {
    const response = await fetch(`${API_BASE}/units/`, { headers: authHeaders() });
    if (!response.ok) throw new Error('Failed to fetch units');
    return response.json();
}

export async function fetchUnit(unitId: string): Promise<any> {
    const response = await fetch(`${API_BASE}/units/${unitId}`, { headers: authHeaders() });
    if (!response.ok) throw new Error('Failed to fetch unit');
    return response.json();
}

export async function updateUnit(unitId: string, payload: UnitUpdateRequest): Promise<any> {
    const response = await fetch(`${API_BASE}/units/${unitId}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(payload)
    });
    if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to update package'));
    }
    return response.json();
}

export async function createUnit(unit: UnitCreateRequest): Promise<{ status: string; unit_id: string; message: string }> {
    const response = await fetch(`${API_BASE}/units/`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(unit)
    });
    if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to create package'));
    }
    return response.json();
}

export async function deleteUnit(unitId: string): Promise<{ status: string; unit_id: string }> {
    const response = await fetch(`${API_BASE}/units/${unitId}`, {
        method: 'DELETE',
        headers: authHeaders()
    });
    if (!response.ok) {
        throw new Error(await getApiErrorMessage(response, 'Failed to delete package'));
    }
    return response.json();
}

export async function fetchUnitSummary(unitId: string): Promise<any> {
    const response = await fetch(`${API_BASE}/units/${unitId}/summary`);
    if (!response.ok) throw new Error('Failed to fetch package summary');
    return response.json();
}

// ============ LIVE DATA ============

export async function fetchLiveData(unitId: string = 'GCS-001'): Promise<LiveDataResponse> {
    const response = await fetch(`${API_BASE}/units/${unitId}/live`);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response.json();
}

export async function fetchResolvedData(unitId: string = 'GCS-001'): Promise<LiveDataResponse> {
    const response = await fetch(`${API_BASE}/units/${unitId}/resolved`);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response.json();
}

// ============ CONFIG ============

export async function fetchEquipmentConfig(unitId: string): Promise<EquipmentConfig> {
    const response = await fetch(`${API_BASE}/config/equipment/${unitId}`);
    if (!response.ok) throw new Error('Failed to fetch equipment config');
    return response.json();
}

export async function saveEquipmentConfig(unitId: string, config: EquipmentConfig): Promise<{ status: string }> {
    const response = await fetch(`${API_BASE}/config/equipment/${unitId}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(config)
    });
    if (!response.ok) throw new Error('Failed to save equipment config');
    return response.json();
}

export async function fetchGasConfig(unitId: string): Promise<any> {
    const response = await fetch(`${API_BASE}/config/gas/${unitId}`);
    if (!response.ok) throw new Error('Failed to fetch gas config');
    return response.json();
}

export async function saveGasConfig(unitId: string, config: any): Promise<{ status: string }> {
    const response = await fetch(`${API_BASE}/config/gas/${unitId}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(config)
    });
    if (!response.ok) throw new Error('Failed to save gas config');
    return response.json();
}

// ============ MODBUS ============

export async function fetchModbusConfig(unitId: string): Promise<any> {
    const params = new URLSearchParams({ unit_id: unitId });
    const response = await fetch(`${API_BASE}/config/modbus?${params.toString()}`);
    if (!response.ok) throw new Error('Failed to fetch Modbus config');
    return response.json();
}

export async function updateModbusConfig(unitId: string, config: any): Promise<{ status: string }> {
    const params = new URLSearchParams({ unit_id: unitId });
    const response = await fetch(`${API_BASE}/config/modbus?${params.toString()}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(config)
    });
    if (!response.ok) throw new Error('Failed to update Modbus config');
    return response.json();
}

// ============ ALARMS ============

export async function fetchActiveAlarms(unitId: string): Promise<{ alarms: AlarmActive[] }> {
    const response = await fetch(`${API_BASE}/units/${unitId}/alarms/active`, {
        headers: authHeaders()
    });
    if (!response.ok) throw new Error('Failed to fetch alarms');
    const data = await response.json();
    const alarms = (data.active_alarms || []).map((a: any) => ({
        id: a.key,
        parameter: a.parameter,
        level: a.level,
        value: a.value,
        setpoint: a.setpoint,
        timestamp: a.triggered_at,
        acknowledged: a.state === 'acknowledged'
    }));
    return { alarms };
}

export async function fetchAlarmsSummary(unitId: string): Promise<any> {
    const response = await fetch(`${API_BASE}/alarms/${unitId}/summary`);
    if (!response.ok) throw new Error('Failed to fetch alarm summary');
    return response.json();
}

export async function acknowledgeAlarm(unitId: string, alarmKey: string): Promise<{ status: string }> {
    const response = await fetch(`${API_BASE}/units/${unitId}/alarms/acknowledge`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ alarm_key: alarmKey })
    });
    if (!response.ok) throw new Error('Failed to acknowledge alarm');
    return response.json();
}

export async function fetchAlarmSetpoints(unitId: string): Promise<any> {
    const response = await fetch(`${API_BASE}/alarms/setpoints?unit_id=${unitId}`, {
        headers: authHeaders()
    });
    if (!response.ok) throw new Error('Failed to fetch alarm setpoints');
    return response.json();
}

// ============ ALARM HISTORY ============

export interface AlarmEvent {
    id: number;
    parameter: string;
    level: string;
    value: number;
    setpoint: number;
    is_shutdown: boolean;
    triggered_at: string;
    cleared_at: string | null;
    acknowledged_at: string | null;
    acknowledged_by: string | null;
    notes: string | null;
}

export async function fetchAlarmHistory(
    unitId: string,
    options: { limit?: number; hours?: number; activeOnly?: boolean } = {}
): Promise<{ unit_id: string; events: AlarmEvent[]; count: number; hours_queried: number }> {
    const params = new URLSearchParams();
    if (options.limit) params.append('limit', options.limit.toString());
    if (options.hours) params.append('hours', options.hours.toString());
    if (options.activeOnly) params.append('active_only', 'true');
    
    const response = await fetch(`${API_BASE}/alarms/${unitId}/history?${params}`, {
        headers: authHeaders()
    });
    if (!response.ok) throw new Error('Failed to fetch alarm history');
    return response.json();
}

export async function acknowledgeAlarmEvent(
    unitId: string,
    eventId: number,
    notes?: string
): Promise<{ status: string; id: number }> {
    const response = await fetch(`${API_BASE}/alarms/${unitId}/events/${eventId}/acknowledge`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ notes: notes || null })
    });
    if (!response.ok) throw new Error('Failed to acknowledge alarm event');
    return response.json();
}

export async function clearAlarmEvent(
    unitId: string,
    eventId: number
): Promise<{ status: string; id: number }> {
    const response = await fetch(`${API_BASE}/alarms/${unitId}/events/${eventId}/clear`, {
        method: 'POST',
        headers: authHeaders()
    });
    if (!response.ok) throw new Error('Failed to clear alarm event');
    return response.json();
}

// ============ SITE CONDITIONS ============

export interface SiteConditions {
    elevation_ft: number;
    barometric_psi: number;
    ambient_temp_f: number;
    design_ambient_f: number;
    cooler_approach_f: number;
    humidity_pct: number;
}

export async function fetchSiteConditions(unitId: string): Promise<{
    unit_id: string;
    site_conditions: SiteConditions;
    updated_at: string | null;
    conditions: SiteConditions; // Added for compatibility if backend inconsistency
}> {
    const response = await fetch(`${API_BASE}/config/site/${unitId}`, {
        headers: authHeaders()
    });
    if (!response.ok) throw new Error('Failed to fetch site conditions');
    return response.json();
}

export async function updateSiteConditions(
    unitId: string,
    conditions: SiteConditions
): Promise<{ status: string; unit_id: string; site_conditions: SiteConditions }> {
    const response = await fetch(`${API_BASE}/config/site/${unitId}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(conditions)
    });
    if (!response.ok) throw new Error('Failed to update site conditions');
    return response.json();
}

export async function fetchDerating(unitId: string): Promise<{
    unit_id: string;
    altitude_derating: number;
    temperature_derating: number;
    combined_derating: number;
    conditions: SiteConditions;
}> {
    const response = await fetch(`${API_BASE}/config/site/${unitId}/derating`);
    if (!response.ok) throw new Error('Failed to fetch derating');
    return response.json();
}

// ============ TRENDING ============

export async function fetchTrendData(unitId: string, query: TrendQuery): Promise<any> {
    const params = new URLSearchParams({
        parameters: query.parameters.join(','),
        start: query.start,
        stop: query.end,
        aggregate: query.aggregation || '1m'
    });
    const response = await fetch(`${API_BASE}/trends/${unitId}?${params}`);
    if (!response.ok) throw new Error('Failed to fetch trend data');
    return response.json();
}

// ============ DIAGRAMS ============

export async function fetchPVDiagram(unitId: string, stage: number = 1) {
    const response = await fetch(`${API_BASE}/units/${unitId}/diagrams/pv?stage=${stage}`);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response.json();
}

export async function fetchPTDiagram(unitId: string) {
    const response = await fetch(`${API_BASE}/units/${unitId}/diagrams/pt`);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    return response.json();
}

// ============ PHYSICS ============

export async function fetchPhysicsResults(unitId: string): Promise<any> {
    const response = await fetch(`${API_BASE}/units/${unitId}/physics`);
    if (!response.ok) throw new Error('Failed to fetch physics results');
    return response.json();
}

// ============ PERFORMANCE ============

export async function fetchPerformanceSummary(unitId: string): Promise<any> {
    const response = await fetch(`${API_BASE}/units/${unitId}/performance/summary`);
    if (!response.ok) throw new Error('Failed to fetch performance summary');
    return response.json();
}

export async function fetchPerformanceEfficiency(
    unitId: string,
    query: { start?: string; aggregate?: string } = {}
): Promise<any> {
    const params = new URLSearchParams();
    if (query.start) params.set('start', query.start);
    if (query.aggregate) params.set('aggregate', query.aggregate);
    const url = `${API_BASE}/units/${unitId}/performance/efficiency${params.toString() ? `?${params.toString()}` : ''}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch efficiency trends');
    return response.json();
}

export async function fetchPerformancePower(
    unitId: string,
    query: { start?: string; aggregate?: string } = {}
): Promise<any> {
    const params = new URLSearchParams();
    if (query.start) params.set('start', query.start);
    if (query.aggregate) params.set('aggregate', query.aggregate);
    const url = `${API_BASE}/units/${unitId}/performance/power${params.toString() ? `?${params.toString()}` : ''}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch power analytics');
    return response.json();
}

export async function fetchPerformanceDegradation(
    unitId: string,
    query: { start?: string; aggregate?: string } = {}
): Promise<any> {
    const params = new URLSearchParams();
    if (query.start) params.set('start', query.start);
    if (query.aggregate) params.set('aggregate', query.aggregate);
    const url = `${API_BASE}/units/${unitId}/performance/degradation${params.toString() ? `?${params.toString()}` : ''}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to fetch degradation analytics');
    return response.json();
}

// ============ WEBSOCKET ============

export function createWebSocket(unitId: string, onMessage: (data: any) => void, onError?: (error: any) => void) {
    const ws = new WebSocket(`${WS_ORIGIN}/api/units/ws/${unitId}`);

    ws.onopen = () => console.log('WebSocket connected');
    ws.onmessage = (event) => {
        try {
            onMessage(JSON.parse(event.data));
        } catch (e) {
            console.error('Failed to parse WebSocket message:', e);
        }
    };
    ws.onerror = (event) => {
        console.error('WebSocket error:', event);
        if (onError) onError(event);
    };
    ws.onclose = () => console.log('WebSocket disconnected');

    return ws;
}
