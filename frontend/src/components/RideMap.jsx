// src/components/RideMap.jsx
import React, { useEffect, useRef } from 'react';

// NYC center as default
const DEFAULT_CENTER = [40.7589, -73.9851];
const DEFAULT_ZOOM = 13;

export default function RideMap({
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
  markers = [],
  onMapClick,
  className = '',
}) {
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRefs = useRef([]);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    // Dynamically import Leaflet to avoid SSR issues
    import('leaflet').then((L) => {
      const map = L.map(mapRef.current, {
        center,
        zoom,
        zoomControl: false,
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      L.control.zoom({ position: 'bottomright' }).addTo(map);

      if (onMapClick) {
        map.on('click', (e) => {
          onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng });
        });
      }

      mapInstanceRef.current = { map, L };
    });

    return () => {
      mapInstanceRef.current?.map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update markers
  useEffect(() => {
    if (!mapInstanceRef.current) return;
    const { map, L } = mapInstanceRef.current;

    // Remove old markers
    markerRefs.current.forEach(m => m.remove());
    markerRefs.current = [];

    // Add new markers
    markers.forEach((m) => {
      const iconHtml = m.type === 'driver'
        ? `<div style="font-size:24px;filter:drop-shadow(0 0 6px #22c55e)">🚗</div>`
        : m.type === 'pickup'
        ? `<div style="font-size:24px;filter:drop-shadow(0 0 6px #3b82f6)">📍</div>`
        : `<div style="font-size:24px;filter:drop-shadow(0 0 6px #f59e0b)">🏁</div>`;

      const icon = L.divIcon({
        html: iconHtml,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        className: '',
      });

      const marker = L.marker([m.lat, m.lng], { icon })
        .addTo(map);

      if (m.tooltip) {
        marker.bindTooltip(m.tooltip, {
          permanent: false,
          className: 'leaflet-tooltip-custom',
        });
      }

      markerRefs.current.push(marker);
    });
  }, [markers]);

  // Pan to center when it changes
  useEffect(() => {
    if (!mapInstanceRef.current || !center) return;
    mapInstanceRef.current.map.setView(center, zoom, { animate: true });
  }, [center, zoom]);

  return (
    <div
      ref={mapRef}
      className={`rounded-xl overflow-hidden ${className}`}
      style={{ minHeight: 300 }}
    />
  );
}
