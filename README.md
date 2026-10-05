# PowerAuto

Next.js reúne búsqueda de llantas y baterías en una sola experiencia y registra
herramientas WebMCP; Google ADK orquesta la conversación con
`gemini-3.8-flash`.

## Requisitos

- Node.js y npm
- Python 3.11–3.13 con `uv`
- Un navegador con WebMCP nativo
- `GEMINI_API_KEY` disponible solo en el proceso server-side

## Catálogo

Para llantas, la aplicación consulta la fuente pública actual mediante las rutas
same-origin `/api/catalog/search` y `/api/catalog/stock`. Usa `cache: no-store`,
procesa las respuestas en memoria y devuelve como máximo cinco productos.

Soporta autos, camionetas/SUV, camiones y motos. Para motos utiliza la única
agrupación de stock `MOTO` reportada por la fuente. Los precios y existencias
son informativos y corresponden al momento de cada consulta.

Para cualquier búsqueda por vehículo, el agente obtiene primero marcas y
aplicaciones canónicas mediante `discover_catalog`. La comprensión del texto del
usuario pertenece al modelo; las búsquedas reciben IDs exactos ya descubiertos.
Los IDs se validan contra el producto y contexto vigente antes de consultar.

Para baterías, usa el catálogo JSON aprobado del proyecto. El inventario se
muestra por localidad y no constituye una reserva.

Para comparar especificaciones sin vehículo, `read_battery_catalog` devuelve las
fichas completas al modelo. El modelo elige las alternativas y las presenta con
`present_battery_alternatives`; mostrarlas no selecciona ni cotiza un producto.
Los IDs deben proceder del listado vigente de esa misma sesión.

En voz/video, `inspect_camera_battery` analiza el último fotograma de la sesión
autenticada. El modelo formula la consulta de Google Search con la referencia
exacta o la marca/línea legible; devuelve datos parciales, evidencia de imagen y
enlaces de fuentes. Si la referencia es incierta, devuelve candidatos por identificar,
no especificaciones web atribuidas al objeto.
Una identificación incierta no autoriza atribuir especificaciones web. Comparar
capacidad no verifica compatibilidad con un vehículo. El fotograma se conserva
solo en memoria mientras la cámara está activa; no se guarda en disco. Usa la
misma `GEMINI_API_KEY` server-side, sin una clave de búsqueda adicional.

## Desarrollo local

Terminal 1:

```bash
GEMINI_API_KEY=... uv run uvicorn agent.fast_api_app:app --port 8000
```

Terminal 2:

```bash
npm run dev
```

Abrir `http://localhost:3000/search`. Si ADK usa otra URL, configurar
`ADK_AGENT_URL` en el proceso de Next.

## Validación sin llamadas al modelo

```bash
npm test
npm run test:python
npm run typecheck
npm run lint
npm run build
```

Con ADK reiniciado y `GEMINI_API_KEY` configurada en ese servidor:

```bash
npm run test:vehicle-agent
npm run test:catalog-flow
npm run test:catalog-context
npm run test:battery-comparison
```

Los evals verifican que las instrucciones cargadas coincidan con el código actual y
guardan las trazas en `artifacts/evals`. El primero comprueba acciones individuales;
el segundo ejecuta las herramientas WebMCP y el estado de selección/cotización en
recorridos de llantas y baterías con respuestas de proveedor simuladas.
`test:catalog-context` ejecuta conversaciones completas de cambios de año y vehículo,
aclaraciones de año faltante y limpieza de selecciones/cotizaciones anteriores. Usa
el catálogo local real de baterías y fixtures de proveedor para llantas. Con Next
local iniciado, `npm run test:catalog-ui` valida también el estado visual y las
herramientas consecutivas en desktop/móvil sin llamadas al modelo.

`test:battery-comparison` ejecuta comparación y confirmación con el agente real
y el JSON local, comprobando que no se seleccione ni cotice antes de confirmar.
`node scripts/verify-battery-comparison-browser.mjs` verifica escritorio/móvil.
`node scripts/verify-battery-camera.mjs` usa una etiqueta del catálogo como video
y un audio sintético PCM de 16 kHz mono (`EVAL_AUDIO_PCM`, por defecto
`/tmp/powerauto-battery-eval.pcm`) para validar el recorrido real de Gemini Live.
No accede a la cámara personal ni realiza pagos. Sus trazas omiten audio e imagen.

El escenario `tests/eval/fixtures/battery-camera-followup.json` añade tres turnos
cortos y cambia la imagen en una misma sesión. Usa audios PCM sintéticos de
16 kHz mono en las rutas `audioPath`; ejecútalo con
`EVAL_CAMERA_SCENARIO=tests/eval/fixtures/battery-camera-followup.json node scripts/verify-battery-camera.mjs`.
Verifica una inspección nueva, búsqueda web, alternativas sin vehículo y el cierre
de la respuesta antes de pasar al siguiente turno.

`EVAL_CAMERA_SCENARIO=tests/eval/fixtures/battery-camera-checkout.json node scripts/verify-battery-camera.mjs`
añade la confirmación por voz de la primera alternativa, una unidad y entrega a
domicilio. Requiere `/tmp/powerauto-camera-checkout.pcm` con ese mensaje en PCM
crudo de 16 kHz mono. Comprueba producto, cantidad y modalidad en la cotización,
abre un formulario de prueba sin proveedor ni cobro y exige una sola respuesta
de cierre sin las frases de espera del fixture después del último resultado.
Los resultados WebMCP se serializan como en el navegador real. La comparación
de frases es una aserción del eval; no modifica el texto del agente.

`tests/eval/datasets/visual-evidence-dataset.json` cubre evidencia incierta,
cambio de objeto, comparación parcial y respuesta tras presentar alternativas.
Los datos concretos de estos casos son fixtures, no reglas del catálogo.

La voz registra `live_timing` por sesión y `call_id`: fin de investigación o
recepción del resultado del navegador, entrada en la cola ADK, primera salida
de audio/transcripción y acuse de presentación. El audio se marca cuando el
worklet renderiza el bloque; el texto después de dos frames del navegador.
Son marcas de software, no una medición del altavoz físico. `timing` en los eventos
WebSocket incluye `ingressToAdkMs` y `adkToOutputMs`; las trazas del eval de cámara
los conservan. Ese eval no reproduce audio ni acredita su presentación al usuario.
Los tiempos del servidor usan un reloj monotónico; el fin de herramienta del
navegador usa su reloj de pared, por lo que compararlo entre máquinas requiere
relojes sincronizados. Las marcas correlacionan eventos posteriores al resultado,
sin afirmar que una respuesta determinada utilizó semánticamente esa evidencia.
Una interrupción elimina las correlaciones pendientes. No se registran imágenes,
audio ni argumentos en esta telemetría. Los evals verifican los hashes cargados
por ADK antes de ejecutarse y rechazan instrucciones anteriores al reinicio.

Para diagnosticar llamadas de voz con los logs nativos de ADK, inicia el servidor
desde la raíz del proyecto con tu misma `GEMINI_API_KEY`:

```sh
uv run uvicorn agent.fast_api_app:app --host 127.0.0.1 --port 8000 --log-config scripts/live-debug-logging.json
```

`artifacts/evals/adk-live-native.log` captura recepción de mensajes de Gemini,
despacho de llamadas y envío de resultados, con los IDs originales. Es un log
DEBUG local y puede incluir transcripciones y audio; no publicarlo. Rota a 64 MiB
con dos archivos anteriores. Esta configuración no modifica herramientas, colas
ni respuestas. Después del diagnóstico, vuelve al comando habitual sin `--log-config`.

El catálogo local guarda descubrimientos y resultados en una sesión de servidor,
con credencial aleatoria y 30 minutos de inactividad. Este almacenamiento sigue el
patrón en memoria del demo: un reinicio lo pierde y no se comparte entre instancias.
Antes de desplegar con múltiples instancias requiere almacenamiento compartido.

No existe fallback MCP para navegadores sin WebMCP.

## Pago local y entrega

Las cotizaciones de llantas y baterías incluyen **Pagar con tarjeta**. Para entrega
a domicilio el formulario solicita el GPS al abrirse (respetando el permiso del
navegador) y guarda automáticamente el punto, dirección y referencia, sin botón
de confirmación. Se puede corregir el pin o los textos; ese contexto también
acompaña el handoff al asesor.
El mapa usa OpenStreetMap y completa la dirección desde el GPS o el pin mediante
Nominatim; las correcciones se guardan automáticamente. La demo local no requiere claves.
Guardar la ubicación no inicia pagos. Solo se envían coordenadas
al proveedor, no nombres, datos de facturación ni referencias escritas por el usuario.

El servicio público de Nominatim tiene capacidad limitada: requiere identificación
y atribución, máximo una consulta por segundo por aplicación, caché y no permite
autocompletar búsquedas mientras se escribe. Completar una dirección desde un punto
GPS es geocodificación inversa. Esta demo usa una cola compartida por proceso y caché temporal.
Ver https://operations.osmfoundation.org/policies/nominatim/ .
Para el demo publicado con una única instancia y un único proceso web, habilita
`NOMINATIM_PUBLIC_DEMO_ENABLED=true`; completa la dirección automáticamente sin claves.
No habilites el servicio público simultáneamente en otra revisión o proceso local.
El límite sigue siendo por proceso: esta opción no crea una cuota distribuida.
Para múltiples instancias, configura `NOMINATIM_REVERSE_URL` con un endpoint propio o gestionado.
Si la consulta falla, se permite ingresar la dirección manualmente.

El modo local predeterminado es `PAYMENT_MODE=simulation`: valida facturación,
el botón **Pagar** registra y completa el pago simulado en una sola acción, sin
una segunda confirmación ni enviar datos a un
proveedor ni efectuar cobros. No se solicitan números de tarjeta ni CVV en el chat.

Con Next local activo en modo simulación, `npm run test:payment-flow` comprueba
mapa/GPS, elección manual con permiso denegado, facturación, retiro, cancelación,
reintento y aprobación para baterías y llantas. Usa un transporte WebMCP de prueba
en Chromium; ejecuta herramientas y APIs reales locales, no certifica al LLM ni
un cobro de PagoPlux. Guarda capturas en `/tmp/powerauto-payment-*.png`.
`PAYMENT_MAP_TEST_MODE=fixture npm run test:payment-flow`
comprueba autollenado, consultas atrasadas, edición manual y errores con respuestas
controladas en Chromium sobre el mapa real de OpenStreetMap. Ese modo no certifica
la geocodificación real; no consulta Nominatim durante los escenarios de estrés.

Se copiaron el contrato del formulario, el iframe y el procesamiento de PagoPlux
desde `fullseguraAgentesIA`, adaptando autenticación y almacenamiento a este repo.
No se llama al backend del proyecto de origen ni se comparten sus credenciales.
Para usar exclusivamente sandbox, configura en `.env.local` y reinicia Next:

```dotenv
PAYMENT_MODE=pagoplux_sandbox
PAGOPLUX_ENVIRONMENT=sandbox
PAGOPLUX_MERCHANT_EMAIL=correo_del_comercio
PAGOPLUX_WEBHOOK_BASIC_TOKEN=token_basic_del_webhook
```

El webhook es `/api/payments/pagoplux/webhook`; el proveedor necesita alcanzar
esa URL. La vuelta del iframe no aprueba el pago: solo el webhook autenticado con
importe y referencia correctos confirma un pago sandbox. No existe modo de cobro
en producción en este alcance ni fallback automático a simulación.

El importe se calcula en el servidor a partir del resultado de catálogo vigente;
no se acepta un total enviado por el navegador. Los reintentos de la misma
cotización reutilizan el pago pendiente o aprobado.

El registro local `.local-payments/payments.json` se excluye de Git, conserva datos
de facturación y ubicación y usa permisos restringidos. Puede cambiarse con
`PAYMENTS_STORAGE_DIR`. Es para un único proceso local, no para múltiples
instancias Cloud Run. La sesión de catálogo sigue en memoria y el inventario usado
es el resultado de esa sesión. Producción requiere persistencia compartida,
verificación vigente del proveedor y un flujo real de pedidos/entregas.

## Handoff autónomo por voz

Este challenge no depende de Fullsegura. El cliente usa `/search` y el asesor usa `/advisor`; ambos comparten contexto y una sala LiveKit Cloud.

1. Copia `.env.example` a `.env.local`.
2. Configura `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` y `ADVISOR_ACCESS_TOKEN`.
3. Configura en LiveKit Cloud el webhook público `/api/handoff/livekit/webhook`.
4. Ejecuta `npm run dev`.

El store de casos es temporal y vive en memoria. Para el challenge, el despliegue debe usar una sola instancia. Reiniciar o escalar el proceso elimina la cola.

## Cloud Run

El challenge se despliega en `fullsegura-55e8c` como un servicio aislado con
tres contenedores: Nginx en el puerto público `8080`, Next.js en
`127.0.0.1:3000` y ADK en `127.0.0.1:8000`. Nginx dirige `/ws/live` a ADK y el
resto a Next.js. La escala automática usa mínimo `0` y máximo `1`; al escalar a
cero se elimina la cola temporal.

```bash
gcloud builds submit \
  --project fullsegura-55e8c \
  --config cloudbuild.yaml \
  --substitutions _REGION=us-east1,_REPOSITORY=bateriaspower,_TAG=v1

TAG=v1 ./scripts/deploy-cloud-run.sh
```

El script requiere una cuenta de servicio `bateriaspower-webmcp` y seis
secretos independientes con prefijo `bateriaspower-`; no crea ni modifica
recursos de los servicios Fullsegura existentes.
