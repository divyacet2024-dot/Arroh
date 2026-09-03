import { request } from './api';
import type { InventoryForecastResponse } from '../types';

/** GET /api/v1/inventory/forecast/{phc_id} — critical-supply stockout forecast. */
export function getInventoryForecast(phcId: string): Promise<InventoryForecastResponse> {
  return request<InventoryForecastResponse>({ method: 'GET', url: `/api/v1/inventory/forecast/${encodeURIComponent(phcId)}` });
}
