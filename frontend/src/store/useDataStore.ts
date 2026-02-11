/**
 * Zustand store for live data state management
 */
import { create } from 'zustand';

interface StageData {
  stage: number;
  suction_press: number;
  discharge_press: number;
  suction_temp: number;
  discharge_temp: number;
  ratio: number;
  isentropic_eff: number;
  volumetric_eff: number;
  ideal_temp: number;
}

interface LiveData {
  timestamp: string;
  unit_id: string;
  
  // Engine
  engine_state: number;
  engine_state_label: string;
  hour_meter: number;
  fault_code: number;
  engine_rpm: number;
  engine_oil_press: number;
  engine_oil_temp: number;
  jacket_water_temp: number;
  
  // Compressor
  comp_oil_press: number;
  comp_oil_temp: number;
  stages: StageData[];
  overall_ratio: number;
  total_bhp: number;
  cylinder_temps: number[];
  
  // Exhaust
  exhaust_temps: Record<string, number>;
  exhaust_spread: number;
  exhaust_avg: number;
  pre_turbo_left: number;
  pre_turbo_right: number;
  post_turbo_left: number;
  post_turbo_right: number;
  
  // Bearings
  bearing_temps: number[];
  
  // Control
  suction_valve_pct: number;
  speed_control_pct: number;
  recycle_valve_pct: number;
  
  // Gas detectors
  gas_detector_comp: number;
  gas_detector_engine: number;
  
  // Alarms
  active_alarms: string[];
}

interface DataStore {
  liveData: LiveData | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  
  setLiveData: (data: LiveData) => void;
  setConnected: (connected: boolean) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useDataStore = create<DataStore>((set) => ({
  liveData: null,
  isConnected: false,
  isLoading: true,
  error: null,
  
  setLiveData: (data) => set({ liveData: data, isLoading: false }),
  setConnected: (connected) => set({ isConnected: connected }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error, isLoading: false }),
}));
