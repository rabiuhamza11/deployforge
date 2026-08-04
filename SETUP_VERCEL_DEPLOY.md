# Vercel Auto-Deploy Setup

## Step 1: Get Your Vercel Token
1. Go to https://vercel.com/account/tokens
2. Click "Create Token"
3. Name it "DeployForge Auto-Deploy"
4. Copy the token

## Step 2: Get Your Vercel Org ID & Project ID
1. Go to your Vercel dashboard
2. Create a new project (or use existing "deployforge")
3. Import the GitHub repo: `rabiuhamza11/deployforge`
4. Go to Project Settings > General
5. Copy the "Vercel Org ID" and "Vercel Project ID"

## Step 3: Add GitHub Secrets
Go to: https://github.com/rabiuhamza11/deployforge/settings/secrets/actions

Add these 3 secrets:
- `VERCEL_TOKEN` = your Vercel token from Step 1
- `VERCEL_ORG_ID` = your Vercel Org ID from Step 2
- `VERCEL_PROJECT_ID` = your Vercel Project ID from Step 2

## Step 4: Verify
After adding secrets, push any commit to main:
```bash
git commit --allow-empty -m "test vercel deploy"
git push
```

Both pipelines will run:
1. GitHub Pages → https://rabiuhamza11.github.io/deployforge/
2. Vercel → https://deployforge.vercel.app

## Auto-Deploy Triggers
Both pipelines trigger automatically on:
- Push to `main` branch
- Manual trigger (workflow_dispatch)
