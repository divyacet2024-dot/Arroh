import { useState, type FormEvent } from 'react';
import { Package, RefreshCw, TrendingDown, Warehouse } from 'lucide-react';
import { getInventoryForecast } from '../services/inventory';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { humanize } from '../lib/format';
import { DEFAULT_PHC_ID } from '../lib/constants';
import type { InventoryForecastResponse, StockoutStatus } from '../types';

const statusTone: Record<StockoutStatus, 'red' | 'amber' | 'green'> = {
  CRITICAL_STOCKOUT_RISK: 'red',
  ADEQUATE: 'green',
  STABLE: 'amber',
};

export function Inventory() {
  const [phcId, setPhcId] = useState(DEFAULT_PHC_ID);
  const [data, setData] = useState<InventoryForecastResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!phcId.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const forecast = await getInventoryForecast(phcId.trim());
      setData(forecast);
    } catch (err) {
      setData(null);
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="PHC Inventory"
        description="Critical-supply stockout risk predictions for a primary health centre."
      />

      <form onSubmit={onSubmit} className="max-w-xl">
        <Card title="Forecast">
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Input
                label="PHC ID"
                value={phcId}
                onChange={(event) => setPhcId(event.target.value)}
                placeholder="e.g. PHC-MND-01"
              />
            </div>
            <Button type="submit" loading={loading}>
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> Run forecast
            </Button>
          </div>
        </Card>
      </form>

      {Boolean(error) && <ErrorState error={error} onRetry={() => setError(null)} title="Forecast failed" />}

      {data && <InventoryForecast data={data} />}
    </div>
  );
}

function InventoryForecast({ data }: { data: InventoryForecastResponse }) {
  if (data.forecasts.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title="No inventory forecasts"
        description="The backend returned no stockout forecasts for this PHC."
      />
    );
  }

  const critical = data.forecasts.filter((item) => item.status === 'CRITICAL_STOCKOUT_RISK').length;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="flex items-center gap-2 text-sm font-medium text-slate-500">
            <Warehouse className="h-4 w-4 text-brand-600" aria-hidden="true" /> Active patients
          </p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{data.active_patient_log_count}</p>
        </div>
        <div className="rounded-xl border border-red-100 bg-white p-5 shadow-sm">
          <p className="flex items-center gap-2 text-sm font-medium text-slate-500">
            <TrendingDown className="h-4 w-4 text-priority-red" aria-hidden="true" /> Critical risk
          </p>
          <p className="mt-1 text-2xl font-semibold text-priority-red">{critical}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="flex items-center gap-2 text-sm font-medium text-slate-500">
            <Package className="h-4 w-4 text-brand-600" aria-hidden="true" /> Total medicine lines
          </p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{data.forecasts.length}</p>
        </div>
      </div>

      <Card title="Stockout forecast" subtitle={`PHC ${data.phc_id}`}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.forecasts.map((item) => (
            <div
              key={item.medicine_name}
              className="rounded-xl border border-slate-200 p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-slate-900">{item.medicine_name}</p>
                <Badge tone={statusTone[item.status]}>{humanize(item.status)}</Badge>
              </div>
              <div className="mt-3 space-y-1 text-sm text-slate-600">
                <p>
                  Stock level:{' '}
                  <span className="font-medium text-slate-900">{item.current_stock_level}</span>
                </p>
                <p>
                  Daily use: <span className="font-medium text-slate-900">{item.estimated_daily_consumption}</span>
                </p>
                <p>
                  Reorder at: <span className="font-medium text-slate-900">{item.reorder_threshold}</span>
                </p>
                <p>
                  Days to stockout:{' '}
                  <span className="font-medium text-slate-900">{item.estimated_days_until_stockout}</span>
                </p>
              </div>
              <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                {item.demand_signal}
              </p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
