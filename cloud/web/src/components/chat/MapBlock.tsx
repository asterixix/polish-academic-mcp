import { useEffect, useState } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { geocode } from "@/lib/geocode";

type Place = { label: string; lat: number; lon: number };

// shortcut: city is fixed to Kraków (the only dataset this map was built for); upgrade by passing city from the answer.
const CITY = "Kraków, Polska";

export function MapBlock({ addresses }: { addresses: string[] }) {
  const [places, setPlaces] = useState<Place[]>([]);
  const [pending, setPending] = useState(addresses.length);
  const key = addresses.join("\n");

  useEffect(() => {
    let cancelled = false;
    setPlaces([]);
    setPending(addresses.length);
    addresses.forEach(async (address) => {
      const point = await geocode(`${address}, ${CITY}`).catch(() => null);
      if (cancelled) return;
      setPending((n) => n - 1);
      if (point) setPlaces((prev) => [...prev, { label: address, ...point }]);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div className="my-3">
      <p className="mb-1.5 text-xs text-fg-secondary">
        Lokalizacje: {places.length} z {addresses.length}
        {pending > 0 ? ` (geokodowanie: ${pending} w toku, ok. 1 adres/s)` : ""}
      </p>
      <div className="h-80 overflow-hidden rounded-xl border border-border-primary">
        <MapContainer center={[50.0647, 19.945]} zoom={12} className="h-full w-full">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {places.map((p) => (
            <CircleMarker key={p.label} center={[p.lat, p.lon]} radius={6} pathOptions={{ color: "#1d4ed8" }}>
              <Popup>{p.label}</Popup>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
