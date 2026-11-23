# Deploying to Azure

Indicium runs on Azure Container Apps with Azure Database for PostgreSQL. The template is
`infra/azure/main.bicep`; it deploys a synthetic-data demo by default.

| Piece | Azure resource | Reachable from |
|---|---|---|
| web | Container App, external HTTPS ingress | the internet (the only public entry) |
| api | Container App, internal ingress | the web app only |
| worker | Container App, no ingress | nothing; it polls the database queue |
| migrate | Container Apps Job, manual trigger | run after each deploy |
| database | PostgreSQL Flexible Server, Burstable B1ms, pgvector allow-listed | Azure services |

Locally, Caddy is the single entry point; on Container Apps the managed ingress plays that role,
so the proxy is not deployed.

## Steps

1. Build the images: GitHub, Actions tab, **images**, Run workflow. This publishes
   `ghcr.io/<owner>/indicium-api` and `indicium-web`. Make both packages public (package
   settings), or give the Container Apps a registry credential.
2. Sign in and create a resource group:

   ```sh
   az login
   az group create -n indicium-rg -l centralindia
   ```

3. Deploy (choose a strong database password):

   ```sh
   az deployment group create -g indicium-rg -f infra/azure/main.bicep \
     -p dbPassword='<strong password>'
   ```

   With a model: add `provider=openai openaiBaseUrl=... openaiModel=... openaiApiKey=...`
   (for example Gemini's OpenAI-compatible endpoint).

4. Run the migrations, policies and demo data, then open the URL the deployment printed:

   ```sh
   az containerapp job start -g indicium-rg -n indicium-migrate
   ```

5. To stop spending credit, delete the resource group: `az group delete -n indicium-rg`.

## Cost

The database (Burstable B1ms) and four always-on containers are the main costs; check the
Azure pricing calculator for your region before deploying. Setting `minReplicas: 0` on web and
api lets them scale to zero when idle (the first request is then slower).

## Production notes

The template deploys the demo (`demoMode=true`): synthetic cases and demo sign-ins shown on the
sign-in page. For anything else, deploy with `demoMode=false`, create users with
`python -m indicium.api.users create`, and keep the database on a private network.
