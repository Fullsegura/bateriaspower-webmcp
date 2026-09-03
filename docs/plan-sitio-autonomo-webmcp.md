# Plan: handoff autónomo BateríasPower

Estado: `APPROVED_IN_IMPLEMENTATION`

Fecha: 2026-09-01

## Alcance

- Todo el desarrollo vive en `/Volumes/LGExt/dev/fullsegura/webmcp`.
- No se modifica ni consume código, APIs, datos, app móvil o despliegues de Fullsegura.
- El cliente usa el ChatUI actual en `/search`.
- El asesor usa una nueva vista `/advisor`.
- Ambos se conectan por audio mediante un proyecto LiveKit Cloud separado.
- El asesor recibe nombre, transcript, vehículo, batería y carrito.
- Tenant único fijado server-side mediante `WEBMCP_TENANT_ID`.
- Acceso del asesor protegido mediante `ADVISOR_ACCESS_TOKEN`.

## Límites explícitos

- Demo autónoma para el challenge, no plataforma productiva.
- Estado temporal en memoria de un solo proceso.
- Los casos se pierden al reiniciar o escalar el servidor.
- Sin PushKit, CallKit, PSTN, WhatsApp, Twilio ni notificaciones móviles.
- Sin persistencia, pagos, pedidos o efectos comerciales.
- Sin cambios al ADK actual.
- El despliegue público requiere una sola instancia mientras se use este store.

## Flujo

1. Cliente conversa y prepara su selección.
2. Pulsa `Hablar con asesor`.
3. Next crea un caso temporal y un token LiveKit limitado a micrófono.
4. El cliente entra a la sala y envía heartbeat.
5. `/advisor` consulta la cola y muestra el contexto.
6. El asesor acepta y recibe un token para la misma sala.
7. Ambos hablan; pueden silenciar o finalizar.
8. El caso termina por cliente, asesor, evento LiveKit o vencimiento del heartbeat.

## Seguridad mínima

- Credenciales LiveKit solo server-side.
- Token por participante, sala exacta, TTL corto, micrófono y suscripción.
- Publicación de cámara, pantalla y datos deshabilitada.
- Secreto de cliente aleatorio por caso.
- Token de asesor enviado como bearer.
- Input acotado y validado.
- Webhook LiveKit autenticado.

## Evidencia requerida

- Tests de store, secreto, transición y expiración.
- Test de grants del token.
- Typecheck, lint, build y suite completa.
- Render desktop y móvil de cliente y asesor.
- Smoke con dos navegadores y audio bidireccional real cuando existan credenciales LiveKit.
- Un build exitoso no demuestra audio real.

## Fuera de alcance

- Fullsegura completa.
- Las búsquedas solicitadas en Colas y Clientes de Fullsegura.
- App iOS/Android.
- Persistencia multi-instancia.
- Commit, push o despliegue sin autorización separada.
