import { useState } from 'react';
import { MapPin, Phone, Clock, Globe, Navigation, Search, Loader2 } from 'lucide-react';
import { getNearbyPlaces } from '../services/places';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import type { NearbyPlace, NearbyPlacesResponse } from '../types';

type Status = 'idle' | 'locating' | 'loading' | 'ready' | 'error';

function distanceLabel(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1)} km`;
}

export function HospitalFinder() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [placeType, setPlaceType] = useState<'hospital' | 'pharmacy'>('hospital');
  const [radius, setRadius] = useState(5000);
  const [data, setData] = useState<NearbyPlacesResponse | null>(null);

  async function search(lat: number, lon: number) {
    setStatus('loading');
    setError(null);
    try {
      const res = await getNearbyPlaces({ lat, lon, radius, placeType });
      setData(res);
      setStatus('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setStatus('error');
    }
  }

  function requestLocation() {
    if (!('geolocation' in navigator)) {
      setError('Geolocation is not supported by this browser.');
      setStatus('error');
      return;
    }
    setStatus('locating');
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        void search(pos.coords.latitude, pos.coords.longitude);
      },
      (err) => {
        setError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied. Enter coordinates manually or enable location access.'
            : 'Unable to determine your location. Please try again.',
        );
        setStatus('error');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }

  const [manualLat, setManualLat] = useState('');
  const [manualLon, setManualLon] = useState('');

  function searchManual() {
    const lat = parseFloat(manualLat);
    const lon = parseFloat(manualLon);
    if (Number.isNaN(lat) || Number.isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      setError('Please enter valid latitude and longitude.');
      setStatus('error');
      return;
    }
    void search(lat, lon);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hospital & Pharmacy Finder"
        description="Find nearby hospitals and pharmacies using your location. Results come from OpenStreetMap and are provided for informational purposes."
      />

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">Type</span>
            <select
              value={placeType}
              onChange={(e) => setPlaceType(e.target.value as 'hospital' | 'pharmacy')}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              aria-label="Place type"
            >
              <option value="hospital">Hospital</option>
              <option value="pharmacy">Pharmacy</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">Radius (m)</span>
            <select
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              aria-label="Search radius"
            >
              <option value={2000}>2 km</option>
              <option value={5000}>5 km</option>
              <option value={10000}>10 km</option>
              <option value={25000}>25 km</option>
            </select>
          </label>
          <Button onClick={requestLocation} disabled={status === 'locating' || status === 'loading'}>
            {status === 'locating' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <MapPin className="h-4 w-4" aria-hidden="true" />}
            <span className="ml-2">Use my location</span>
          </Button>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">Latitude</span>
            <input
              type="number"
              step="any"
              value={manualLat}
              onChange={(e) => setManualLat(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              aria-label="Manual latitude"
              placeholder="e.g. 12.9716"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium text-slate-700">Longitude</span>
            <input
              type="number"
              step="any"
              value={manualLon}
              onChange={(e) => setManualLon(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              aria-label="Manual longitude"
              placeholder="e.g. 77.5946"
            />
          </label>
          <div className="flex items-end">
            <Button variant="outline" onClick={searchManual} disabled={status === 'loading'}>
              <Search className="h-4 w-4" aria-hidden="true" />
              <span className="ml-2">Search manually</span>
            </Button>
          </div>
        </div>

        {status === 'error' && error && (
          <div className="mt-4 rounded-xl border border-red-100 bg-red-50/60 px-6 py-4 text-sm text-red-700" role="alert">
            {error}
          </div>
        )}
      </Card>

      {status === 'loading' && (
        <div className="flex items-center gap-2 text-sm text-slate-600" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Searching nearby places…
        </div>
      )}

      {status === 'ready' && data && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Found {data.count} {placeType === 'hospital' ? 'hospital(s)' : 'pharmacy/pharmacies'} within {(data.radius_m / 1000).toFixed(1)} km.
            Source: {data.provider}.
          </p>
          {data.results.length === 0 && (
            <Card>
              <p className="text-sm text-slate-600">No results found. Try a larger radius.</p>
            </Card>
          )}
          <ul className="space-y-3" aria-label="Nearby places">
            {data.results.map((place: NearbyPlace, idx: number) => (
              <li key={`${place.latitude}-${place.longitude}-${idx}`}>
                <Card>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-slate-900">{place.name}</h3>
                      <p className="mt-1 text-sm text-slate-600">
                        {distanceLabel(place.distance_km)} away
                      </p>
                      {place.address && (
                        <p className="mt-1 text-sm text-slate-600">{place.address}</p>
                      )}
                      {place.phone && (
                        <p className="mt-1 flex items-center gap-1 text-sm text-slate-600">
                          <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                          <a href={`tel:${place.phone}`} className="text-brand-600 hover:underline">
                            {place.phone}
                          </a>
                        </p>
                      )}
                      {place.opening_hours && (
                        <p className="mt-1 flex items-center gap-1 text-sm text-slate-600">
                          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                          {place.opening_hours}
                        </p>
                      )}
                      {place.website && (
                        <p className="mt-1 flex items-center gap-1 text-sm">
                          <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                          <a href={place.website} target="_blank" rel="noopener noreferrer" className="text-brand-600 hover:underline">
                            Website
                          </a>
                        </p>
                      )}
                    </div>
                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${place.latitude},${place.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0"
                      aria-label={`Get directions to ${place.name}`}
                    >
                      <Button variant="outline" size="sm">
                        <Navigation className="h-4 w-4" aria-hidden="true" />
                        <span className="ml-1">Directions</span>
                      </Button>
                    </a>
                  </div>
                  <p className="mt-2 text-xs text-slate-400">Source: {place.source}</p>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}