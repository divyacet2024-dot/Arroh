import { request } from './api';
import type { NearbyPlacesResponse } from '../types';

const BASE = '/api/v1/places';

export interface NearbyParams {
  lat: number;
  lon: number;
  radius?: number;
  placeType?: 'hospital' | 'pharmacy' | 'all';
  limit?: number;
}

export function getNearbyPlaces(params: NearbyParams): Promise<NearbyPlacesResponse> {
  return request<NearbyPlacesResponse>({
    method: 'GET',
    url: `${BASE}/nearby`,
    params: {
      lat: params.lat,
      lon: params.lon,
      radius: params.radius ?? 5000,
      place_type: params.placeType ?? 'hospital',
      limit: params.limit ?? 20,
    },
  });
}