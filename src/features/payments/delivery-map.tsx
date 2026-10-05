"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { LocateFixed, MapPin, RotateCcw } from "lucide-react";
import { currentBrowserCoordinates, type BrowserCoordinates } from "@/lib/browser-location";
import type { DeliveryLocation } from "@/types/payment";
import type { Map as LeafletMap, Marker } from "leaflet";
import styles from "./payment-dialog.module.css";

export default function DeliveryMap({ value, disabled, onSave, busy, onValidityChange, resolveAddress }: {
  value: DeliveryLocation | null;
  disabled: boolean;
  busy: boolean;
  onSave(location: DeliveryLocation): Promise<unknown>;
  onValidityChange(valid: boolean): void;
  resolveAddress(point: BrowserCoordinates, signal: AbortSignal): Promise<string>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const [point, setPoint] = useState<BrowserCoordinates | null>(value);
  const [address, setAddress] = useState(value?.address ?? "");
  const [reference, setReference] = useState(value?.reference ?? "");
  const [locating, setLocating] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const saveRef = useRef(onSave);
  const attemptedSaveRef = useRef<string | null>(null);
  const mountedRef = useRef(false);
  const draftKeyRef = useRef<string | null>(null);
  const autoLocatedRef = useRef(false);
  const lookupRef = useRef<AbortController | null>(null);
  const markRef = useRef<((point: BrowserCoordinates, center?: boolean) => void) | null>(null);
  const pointRef = useRef(point);
  const disabledRef = useRef(disabled);
  useEffect(() => { disabledRef.current = disabled || busy; }, [disabled, busy]);
  useEffect(() => { saveRef.current = onSave; }, [onSave]);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => {
    draftKeyRef.current = point && address.trim()
      ? JSON.stringify({ ...point, address: address.trim(), reference: reference.trim() })
      : null;
  }, [point, address, reference]);

  const choosePoint = useCallback((coordinates: BrowserCoordinates) => {
    if (disabledRef.current) return;
    lookupRef.current?.abort();
    const lookup = new AbortController();
    lookupRef.current = lookup;
    pointRef.current = coordinates;
    setPoint(coordinates);
    setAddress("");
    setError(null);
    setSaveFailed(false);
    setResolving(true);
    void resolveAddress(coordinates, lookup.signal).then((resolved) => {
      if (!lookup.signal.aborted) setAddress(resolved);
    }).catch((caught) => {
      if (!lookup.signal.aborted) setError(caught instanceof Error ? caught.message : "No se pudo obtener la dirección. Escríbela para continuar.");
    }).finally(() => {
      if (!lookup.signal.aborted) setResolving(false);
    });
  }, [resolveAddress]);

  useEffect(() => {
    let active = true;
    let resize: ResizeObserver | undefined;
    void import("leaflet").then((L) => {
      if (!active || !containerRef.current) return;
      const initial = pointRef.current;
      const map = L.map(containerRef.current, { scrollWheelZoom: false });
      map.setView(initial ? [initial.latitude, initial.longitude] : [0, 0], initial ? 17 : 2);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      const pinIcon = L.icon({
        iconUrl: typeof markerIcon === "string" ? markerIcon : markerIcon.src,
        shadowUrl: typeof markerShadow === "string" ? markerShadow : markerShadow.src,
        iconSize: [25, 41], iconAnchor: [12, 41], shadowSize: [41, 41],
      });
      mapRef.current = map;
      const mark = (coordinates: BrowserCoordinates, center = false) => {
        if (!markerRef.current) {
          const marker = L.marker([coordinates.latitude, coordinates.longitude], { icon: pinIcon, draggable: !disabledRef.current, title: "Punto de entrega" }).addTo(map);
          marker.on("dragend", () => {
            const { lat, lng } = marker.getLatLng();
            choosePoint({ latitude: lat, longitude: lng });
          });
          markerRef.current = marker;
        } else markerRef.current.setLatLng([coordinates.latitude, coordinates.longitude]);
        if (center) map.setView([coordinates.latitude, coordinates.longitude], 17);
      };
      markRef.current = mark;
      if (initial) mark(initial);
      map.on("click", (event) => {
        if (disabledRef.current) return;
        const coordinates = { latitude: event.latlng.lat, longitude: event.latlng.lng };
        mark(coordinates);
        choosePoint(coordinates);
      });
      resize = new ResizeObserver(() => map.invalidateSize());
      resize.observe(containerRef.current);
      setMapReady(true);
    }).catch((caught) => { if (active) setMapError(caught instanceof Error ? caught.message : "No se pudo abrir el mapa. Intenta nuevamente."); });
    return () => {
      active = false;
      lookupRef.current?.abort();
      resize?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null; markerRef.current = null; markRef.current = null;
    };
  }, [choosePoint]);

  useEffect(() => {
    if (disabled || busy) markerRef.current?.dragging?.disable();
    else markerRef.current?.dragging?.enable();
  }, [disabled, busy]);

  const locate = useCallback(async () => {
    const previousPoint = pointRef.current;
    setLocating(true); setError(null);
    try {
      const coordinates = await currentBrowserCoordinates();
      if (disabledRef.current || !mapRef.current || pointRef.current !== previousPoint) return;
      markRef.current?.(coordinates, true);
      choosePoint(coordinates);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo obtener la ubicación."); }
    finally { setLocating(false); }
  }, [choosePoint]);

  useEffect(() => {
    if (!mapReady || disabled || busy || autoLocatedRef.current) return;
    const timer = setTimeout(() => {
      autoLocatedRef.current = true;
      if (!pointRef.current) void locate();
    }, 0);
    return () => clearTimeout(timer);
  }, [mapReady, disabled, busy, locate]);

  const saved = Boolean(value && point && value.latitude === point.latitude && value.longitude === point.longitude &&
    value.address === address.trim() && value.reference === reference.trim());
  useEffect(() => { onValidityChange(saved && !resolving && !locating); }, [saved, resolving, locating, onValidityChange]);

  useEffect(() => {
    if (!point || !address.trim() || saved || resolving || locating || disabled || busy) return;
    const delivery = { ...point, address: address.trim(), reference: reference.trim() };
    const key = JSON.stringify(delivery);
    if (attemptedSaveRef.current === key) return;
    const timer = setTimeout(() => {
      attemptedSaveRef.current = key;
      setSaveFailed(false);
      void saveRef.current(delivery).then((result) => {
        if (mountedRef.current && draftKeyRef.current === key && !result) setSaveFailed(true);
      }).catch(() => {
        if (mountedRef.current && draftKeyRef.current === key) setSaveFailed(true);
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [point, address, reference, saved, resolving, locating, disabled, busy, retry]);

  return <section className={styles.delivery} aria-label="Ubicación de entrega">
    <div className={styles.sectionHeading}><h3><MapPin size={18} /> Ubicación de entrega</h3>
      <button type="button" onClick={() => void locate()} disabled={disabled || locating || busy || !mapReady} title="Compartir mi ubicación">
        <LocateFixed size={17} /> {locating ? "Localizando…" : "Mi ubicación"}
      </button>
    </div>
    <div ref={containerRef} className={styles.map} aria-label="Mapa para elegir el punto de entrega" />
    {mapError ? <p role="alert" className={styles.error}>{mapError}</p> : null}
    <label>Dirección de entrega<input value={address} onChange={(event) => {
      lookupRef.current?.abort(); setResolving(false); setError(null); setSaveFailed(false); setAddress(event.target.value);
    }} disabled={disabled || busy} autoComplete="street-address" maxLength={250} /></label>
    {resolving ? <p role="status" className={styles.coordinates}>Buscando dirección…</p> : null}
    <label>Referencia<input value={reference} onChange={(event) => { setSaveFailed(false); setReference(event.target.value); }} disabled={disabled || busy} maxLength={250} /></label>
    {point ? <p className={styles.coordinates}>{point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}</p> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    {saveFailed ? <button type="button" className={styles.secondary} disabled={disabled || busy}
      onClick={() => { attemptedSaveRef.current = null; setRetry((current) => current + 1); }}>
      <RotateCcw size={17} /> Reintentar guardado
    </button> : null}
  </section>;
}
