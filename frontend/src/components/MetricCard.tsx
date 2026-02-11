/**
 * MetricCard - Reusable widget for displaying a single metric value
 */

interface MetricCardProps {
  title: string;
  value: number | string;
  unit?: string;
  icon?: string;
  trend?: 'up' | 'down' | 'stable';
  status?: 'normal' | 'warning' | 'critical';
  quality?: 'LIVE' | 'CALCULATED' | 'MANUAL' | 'DEFAULT' | 'BAD';
}

const statusColors = {
  normal: 'text-emerald-400',
  warning: 'text-amber-400',
  critical: 'text-red-400',
};

const qualityColors = {
  LIVE: 'bg-emerald-500',
  CALCULATED: 'bg-blue-500',
  MANUAL: 'bg-amber-500',
  DEFAULT: 'bg-orange-500',
  BAD: 'bg-red-500',
};

export function MetricCard({ 
  title, 
  value, 
  unit, 
  icon,
  trend, 
  status = 'normal',
  quality = 'LIVE'
}: MetricCardProps) {
  return (
    <div className="glass-card p-4 relative overflow-hidden group hover:scale-[1.02] transition-transform duration-300">
      {/* Quality indicator dot */}
      <div className={`absolute top-2 right-2 w-2 h-2 rounded-full ${qualityColors[quality]} animate-pulse`} 
           title={quality} />
      
      {/* Background glow effect */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      
      <div className="relative z-10">
        <div className="flex items-center gap-2 mb-2">
          {icon && <span className="text-lg">{icon}</span>}
          <span className="text-sm text-slate-400 font-medium">{title}</span>
        </div>
        
        <div className="flex items-baseline gap-1">
          <span className={`text-3xl font-bold metric-value ${statusColors[status]}`}>
            {typeof value === 'number' ? value.toLocaleString(undefined, { maximumFractionDigits: 1 }) : value}
          </span>
          {unit && <span className="text-sm text-slate-500">{unit}</span>}
        </div>
        
        {trend && (
          <div className="mt-2 text-xs text-slate-500">
            {trend === 'up' && <span className="text-emerald-400">↑ Rising</span>}
            {trend === 'down' && <span className="text-red-400">↓ Falling</span>}
            {trend === 'stable' && <span>→ Stable</span>}
          </div>
        )}
      </div>
    </div>
  );
}
