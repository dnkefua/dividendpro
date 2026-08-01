@echo off
echo ====================================================================
echo Lumina Finance - Hummingbot Google Cloud Run Automated Deployer
echo ====================================================================
echo.

echo 1. Building Hummingbot Gateway Container Image...
gcloud builds submit --tag gcr.io/dividendpro-3b397/hummingbot-gateway:latest -f Dockerfile.hummingbot .

echo.
echo 2. Deploying Hummingbot Gateway Container to Google Cloud Run...
gcloud run deploy hummingbot-gateway ^
  --image gcr.io/dividendpro-3b397/hummingbot-gateway:latest ^
  --platform managed ^
  --region us-central1 ^
  --no-allow-unauthenticated ^
  --set-secrets CONFIG_PASSWORD=hummingbot-config-password:latest ^
  --port 15888 ^
  --memory 2Gi ^
  --cpu 2

echo.
echo ====================================================================
echo Deployment Complete! Hummingbot Gateway is running live 24/7 on Cloud Run.
echo Target URL: https://hummingbot-gateway-dividendpro.run.app
echo ====================================================================
