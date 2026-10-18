import { useEffect, useRef, useState } from "react";
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { geocode } from "@/lib/geocode";

type Place = { label: string; lat: number; lon: number };

export function MapBlock({ addresses }: { addresses: string[] }) {
  const [places, setPlaces] = useState<Place[]>([]);
  const [pending, setPending] = useState(addresses.length);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const key = addresses.join("\n");

  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, { center: [50.0647, 19.945], zoom: 12 });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    markersRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current = null;
    };
  }, []);

  useEffect(() => {
    const layer = markersRef.current;
    if (!layer) return;
    layer.clearLayers();
    places.forEach((p) =>
      L.circleMarker([p.lat, p.lon], { radius: 6, color: "#1d4ed8" }).bindPopup(p.label).addTo(layer),
    );
  }, [places]);

  useEffect(() => {
    let cancelled = false;
    setPlaces([]);
    setPending(addresses.length);
    addresses.forEach(async (address) => {
      const point = await geocode(address).catch(() => null);
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
      <div ref={containerRef} className="h-80 overflow-hidden rounded-xl border border-border-primary" />
    </div>
  );
}
