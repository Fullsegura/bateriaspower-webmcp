// Copied from fullseguraAgentesIA/apps/dashboard/src/lib/browser-location.ts.
export type BrowserCoordinates = {
  latitude: number;
  longitude: number;
};

export function currentBrowserCoordinates(): Promise<BrowserCoordinates> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.reject(new Error("La ubicación no está disponible en este dispositivo."));
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      }),
      (error) => {
        const message = error.code === 1
          ? "El acceso a tu ubicación está bloqueado. Habilita el permiso del navegador o elige el punto de entrega en el mapa."
          : error.code === 2
            ? "El dispositivo no pudo determinar tu ubicación. Intenta nuevamente o elige el punto de entrega en el mapa."
            : error.code === 3
              ? "La búsqueda de ubicación tardó demasiado. Intenta nuevamente o elige el punto de entrega en el mapa."
              : "No se pudo obtener tu ubicación. Elige el punto de entrega en el mapa.";
        reject(new Error(message));
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 },
    );
  });
}
