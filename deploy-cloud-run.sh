#!/bin/bash

# Cloud Run deployment script for Torito Protocol Backend
# Make sure you have gcloud CLI installed and authenticated

# Configuration
PROJECT_ID="torito-protocol"
SERVICE_NAME="torito-backend"
REGION="us-central1"
IMAGE_NAME="gcr.io/$PROJECT_ID/$SERVICE_NAME"

# Build and push Docker image
echo "Building Docker image for linux/amd64 platform..."
docker build --platform linux/amd64 -t $IMAGE_NAME .

echo "Pushing image to Google Container Registry..."
docker push $IMAGE_NAME

# Deploy to Cloud Run
echo "Deploying to Cloud Run..."
gcloud run deploy $SERVICE_NAME \
  --image $IMAGE_NAME \
  --platform managed \
  --region $REGION \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10 \
  --set-env-vars "NODE_ENV=production" \
  --set-env-vars "SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/YOUR_INFURA_PROJECT_ID" \
  --set-env-vars "AAVE_POOL_ADDRESS=0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951" \
  --set-env-vars "USDT_ADDRESS=0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0" \
  --set-env-vars "AUSDT_ADDRESS=0x978206fAe13faF5a8d293FB614326B237684B750" \
  --set-env-vars "DEFAULT_LTV_RATIO=0.75" \
  --set-env-vars "MIN_LOAN_AMOUNT_BOB=100" \
  --set-env-vars "MAX_LOAN_AMOUNT_BOB=50000" \
  --set-env-vars "RATE_LIMIT_WINDOW_MS=900000" \
  --set-env-vars "RATE_LIMIT_MAX_REQUESTS=100" \
  --set-env-vars "PRIVATE_KEY=$PRIVATE_KEY" \
  --set-env-vars "SMART_CONTRACT_ADDRESS=$SMART_CONTRACT_ADDRESS" \
  --project $PROJECT_ID

echo "Deployment completed!"
echo "Service URL: https://$SERVICE_NAME-$REGION.a.run.app"
