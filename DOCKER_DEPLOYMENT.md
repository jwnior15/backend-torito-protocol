# Docker Deployment Guide for Torito Protocol Backend

This guide explains how to containerize and deploy the Torito Protocol Backend to Google Cloud Run.

## Files Created

- `Dockerfile` - Multi-stage Docker build optimized for Cloud Run
- `.dockerignore` - Excludes unnecessary files from build context
- `deploy-cloud-run.sh` - Automated deployment script
- `cloud-run-service.yaml` - Cloud Run service configuration

## Prerequisites

1. **Docker** installed on your local machine
2. **Google Cloud CLI** installed and authenticated
3. **Google Cloud Project** with billing enabled
4. **Container Registry API** or **Artifact Registry API** enabled

## Local Testing

### Build and test the Docker image locally:

```bash
# Build the image
docker build -t torito-protocol-backend .

# Run locally with environment variables
docker run -p 8080:8080 \
  -e PRIVATE_KEY="your_private_key_here" \
  -e SMART_CONTRACT_ADDRESS="your_contract_address_here" \
  -e SEPOLIA_RPC_URL="https://sepolia.infura.io/v3/YOUR_INFURA_PROJECT_ID" \
  torito-protocol-backend

# Test the health endpoint
curl http://localhost:8080/health
```

## Google Cloud Run Deployment

### Method 1: Using the Deployment Script (Recommended)

1. **Update the deployment script:**
   ```bash
   # Edit deploy-cloud-run.sh and update:
   PROJECT_ID="your-actual-gcp-project-id"
   ```

2. **Set your sensitive environment variables:**
   ```bash
   export PRIVATE_KEY="your_actual_private_key"
   export SMART_CONTRACT_ADDRESS="your_actual_contract_address"
   ```

3. **Run the deployment:**
   ```bash
   ./deploy-cloud-run.sh
   ```

### Method 2: Manual gcloud Commands

1. **Authenticate with Google Cloud:**
   ```bash
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   ```

2. **Build and push the image:**
   ```bash
   # Tag the image
   docker tag torito-protocol-backend gcr.io/YOUR_PROJECT_ID/torito-protocol-backend
   
   # Configure Docker to use gcloud as credential helper
   gcloud auth configure-docker
   
   # Push to Google Container Registry
   docker push gcr.io/YOUR_PROJECT_ID/torito-protocol-backend
   ```

3. **Deploy to Cloud Run:**
   ```bash
   gcloud run deploy torito-protocol-backend \
     --image gcr.io/YOUR_PROJECT_ID/torito-protocol-backend \
     --platform managed \
     --region us-central1 \
     --allow-unauthenticated \
     --port 8080 \
     --memory 512Mi \
     --cpu 1 \
     --set-env-vars "PRIVATE_KEY=your_private_key,SMART_CONTRACT_ADDRESS=your_contract_address"
   ```

### Method 3: Using YAML Configuration

1. **Update the YAML file:**
   Edit `cloud-run-service.yaml` and replace `YOUR_PROJECT_ID` with your actual project ID.

2. **Deploy using YAML:**
   ```bash
   gcloud run services replace cloud-run-service.yaml --region us-central1
   ```

## Environment Variables

### Required for Cloud Run:
- `PRIVATE_KEY` - Your blockchain private key
- `SMART_CONTRACT_ADDRESS` - Your smart contract address

### Optional (have defaults):
- `PORT` - Server port (Cloud Run sets this to 8080)
- `NODE_ENV` - Environment (production)
- `SEPOLIA_RPC_URL` - Ethereum RPC URL
- `AAVE_POOL_ADDRESS` - Aave pool contract address
- `USDT_ADDRESS` - USDT token address
- `AUSDT_ADDRESS` - aUSDT token address

## Security Best Practices

1. **Use Google Secret Manager** for sensitive data:
   ```bash
   # Create secrets
   echo "your_private_key" | gcloud secrets create private-key --data-file=-
   echo "your_contract_address" | gcloud secrets create contract-address --data-file=-
   
   # Update Cloud Run to use secrets
   gcloud run services update torito-protocol-backend \
     --update-secrets="PRIVATE_KEY=private-key:latest,SMART_CONTRACT_ADDRESS=contract-address:latest"
   ```

2. **Restrict service access** by removing `--allow-unauthenticated` if needed

3. **Set up custom domains** and SSL certificates for production

## Monitoring and Logs

- **View logs:** `gcloud run services logs tail torito-protocol-backend`
- **Monitor performance:** Use Google Cloud Console > Cloud Run
- **Health checks:** Service includes `/health` endpoint monitoring

## Scaling Configuration

The service is configured with:
- **Min instances:** 0 (scales to zero when not in use)
- **Max instances:** 10
- **Memory:** 512Mi
- **CPU:** 1 vCPU
- **Concurrency:** 100 requests per instance

## Troubleshooting

1. **Build issues:** Check `.dockerignore` excludes and Dockerfile syntax
2. **Deployment failures:** Verify project ID and region settings
3. **Runtime errors:** Check Cloud Run logs for detailed error messages
4. **Health check failures:** Ensure `/health` endpoint is accessible

## Cost Optimization

- Service scales to zero when not in use
- Pay only for actual usage
- Monitor costs in Google Cloud Console
- Consider using Artifact Registry instead of Container Registry for better pricing

## Next Steps

1. Set up CI/CD pipeline with GitHub Actions or Cloud Build
2. Configure custom domains and SSL
3. Implement proper logging and monitoring
4. Set up staging and production environments
