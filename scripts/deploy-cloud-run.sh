#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-fullsegura-55e8c}"
REGION="${REGION:-us-east1}"
SERVICE_NAME="${SERVICE_NAME:-bateriaspower-webmcp}"
REPOSITORY="${REPOSITORY:-bateriaspower}"
TAG="${TAG:-v1}"
RUNTIME_SERVICE_ACCOUNT="${RUNTIME_SERVICE_ACCOUNT:-bateriaspower-webmcp@${PROJECT_ID}.iam.gserviceaccount.com}"

WEB_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/web:${TAG}"
ADK_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/adk:${TAG}"

required_secrets=(
  bateriaspower-gemini-api-key
  bateriaspower-livekit-url
  bateriaspower-livekit-api-key
  bateriaspower-livekit-api-secret
  bateriaspower-advisor-access-token
)

for secret in "${required_secrets[@]}"; do
  if ! gcloud secrets describe "${secret}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
    echo "Falta el secreto ${secret} en ${PROJECT_ID}." >&2
    exit 1
  fi
done

gcloud artifacts docker images describe "${WEB_IMAGE}" --project "${PROJECT_ID}" >/dev/null
gcloud artifacts docker images describe "${ADK_IMAGE}" --project "${PROJECT_ID}" >/dev/null

gcloud run deploy "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --execution-environment=gen2 \
  --allow-unauthenticated \
  --ingress=all \
  --scaling=auto \
  --min=0 \
  --max-instances=1 \
  --concurrency=20 \
  --timeout=300s \
  --service-account="${RUNTIME_SERVICE_ACCOUNT}" \
  --labels=application=bateriaspower-challenge,component=webmcp \
  --container=web \
  --image="${WEB_IMAGE}" \
  --port=8080 \
  --cpu=1 \
  --memory=1Gi \
  --depends-on=adk \
  --set-env-vars=ADK_AGENT_URL=http://127.0.0.1:8000/orchestrate,WEBMCP_TENANT_ID=baterias-power-demo \
  --set-secrets=LIVEKIT_URL=bateriaspower-livekit-url:latest,LIVEKIT_API_KEY=bateriaspower-livekit-api-key:latest,LIVEKIT_API_SECRET=bateriaspower-livekit-api-secret:latest,ADVISOR_ACCESS_TOKEN=bateriaspower-advisor-access-token:latest \
  --container=adk \
  --image="${ADK_IMAGE}" \
  --cpu=1 \
  --memory=1Gi \
  --command=uv \
  --args=run,uvicorn,agent.fast_api_app:app,--host,0.0.0.0,--port,8000 \
  --startup-probe=initialDelaySeconds=0,timeoutSeconds=2,periodSeconds=5,failureThreshold=12,httpGet.port=8000,httpGet.path=/health \
  --set-secrets=GEMINI_API_KEY=bateriaspower-gemini-api-key:latest

gcloud run services describe "${SERVICE_NAME}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format='value(status.url)'
