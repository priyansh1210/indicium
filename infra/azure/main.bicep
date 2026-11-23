// Indicium on Azure Container Apps with Azure Database for PostgreSQL.
// Deploy: see docs/deploy.md. Everything here is synthetic-data demo infrastructure.

@description('Short name used in every resource name.')
param name string = 'indicium'

param location string = resourceGroup().location

@description('Container images, built by .github/workflows/images.yml.')
param apiImage string = 'ghcr.io/priyansh1210/indicium-api:latest'
param webImage string = 'ghcr.io/priyansh1210/indicium-web:latest'

@description('Postgres administrator password.')
@secure()
param dbPassword string

@description('Load the synthetic demo cases and demo sign-ins. Never for real data.')
param demoMode bool = true

@description('Model provider: baseline (no key) or openai (any OpenAI-compatible endpoint).')
@allowed(['baseline', 'openai'])
param provider string = 'baseline'
param openaiBaseUrl string = ''
param openaiModel string = ''
@secure()
param openaiApiKey string = ''

var dbUser = 'indicium'
var dbName = 'indicium'
var databaseUrl = 'postgresql://${dbUser}:${dbPassword}@${db.properties.fullyQualifiedDomainName}:5432/${dbName}?sslmode=require'

var shared = [
  { name: 'INDICIUM_DATABASE_URL', secretRef: 'database-url' }
  { name: 'INDICIUM_PROVIDER', value: provider }
  { name: 'INDICIUM_OPENAI_BASE_URL', value: openaiBaseUrl }
  { name: 'INDICIUM_OPENAI_MODEL', value: openaiModel }
  { name: 'INDICIUM_OPENAI_API_KEY', secretRef: 'openai-api-key' }
  { name: 'INDICIUM_DEMO_USERS', value: string(demoMode) }
]
var secrets = [
  { name: 'database-url', value: databaseUrl }
  { name: 'openai-api-key', value: empty(openaiApiKey) ? 'none' : openaiApiKey }
]

resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${name}-logs'
  location: location
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30 }
}

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${name}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

resource db 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: '${name}-db-${uniqueString(resourceGroup().id)}'
  location: location
  sku: { name: 'Standard_B1ms', tier: 'Burstable' }
  properties: {
    version: '17'
    administratorLogin: dbUser
    administratorLoginPassword: dbPassword
    storage: { storageSizeGB: 32 }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
  }
}

// pgvector must be allow-listed before `create extension vector` can run.
resource vectorExtension 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: db
  name: 'azure.extensions'
  properties: { value: 'VECTOR', source: 'user-override' }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: db
  name: dbName
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

// Container Apps reach the database over Azure's network ("Allow Azure services").
resource azureServices 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: db
  name: 'allow-azure-services'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

// Migrations, the shipped policies and (demo only) the synthetic cases. Run after each deploy.
resource migrate 'Microsoft.App/jobs@2024-03-01' = {
  name: '${name}-migrate'
  location: location
  dependsOn: [vectorExtension, database, azureServices]
  properties: {
    environmentId: env.id
    configuration: {
      triggerType: 'Manual'
      replicaTimeout: 1800
      replicaRetryLimit: 1
      manualTriggerConfig: { parallelism: 1, replicaCompletionCount: 1 }
      secrets: secrets
    }
    template: {
      containers: [
        {
          name: 'migrate'
          image: apiImage
          command: ['sh', '-c']
          args: [
            'alembic upgrade head && python -m indicium.policies load data/policies --publish && if [ "$INDICIUM_DEMO_DATA" = "true" ]; then python -m indicium.api.users seed-demo && python -m indicium.cases load data/cases; fi'
          ]
          env: concat(shared, [{ name: 'INDICIUM_DEMO_DATA', value: string(demoMode) }])
          resources: { cpu: json('0.5'), memory: '1Gi' }
        }
      ]
    }
  }
}

resource api 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${name}-api'
  location: location
  dependsOn: [migrate]
  properties: {
    environmentId: env.id
    configuration: {
      // Internal only: the web app calls it inside the environment. Not reachable from outside.
      ingress: { external: false, targetPort: 8000, transport: 'http' }
      secrets: secrets
    }
    template: {
      containers: [
        {
          name: 'api'
          image: apiImage
          env: concat(shared, [{ name: 'FORWARDED_ALLOW_IPS', value: '*' }])
          resources: { cpu: json('0.5'), memory: '1Gi' }
          probes: [
            { type: 'Liveness', httpGet: { path: '/health', port: 8000 } }
            { type: 'Readiness', httpGet: { path: '/ready', port: 8000 } }
          ]
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 3 }
    }
  }
}

resource worker 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${name}-worker'
  location: location
  dependsOn: [migrate]
  properties: {
    environmentId: env.id
    configuration: { secrets: secrets }
    template: {
      containers: [
        {
          name: 'worker'
          image: apiImage
          command: ['python', '-m', 'indicium.review.worker']
          env: shared
          resources: { cpu: json('1.0'), memory: '2Gi' }
        }
      ]
      // shortcut: a fixed number of workers; scale on queue depth (a KEDA Postgres rule) when the
      // review volume varies.
      scale: { minReplicas: 1, maxReplicas: 1 }
    }
  }
}

resource web 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${name}-web'
  location: location
  properties: {
    environmentId: env.id
    configuration: {
      // The only public entry point; Azure provides HTTPS.
      ingress: { external: true, targetPort: 3000, transport: 'http', allowInsecure: false }
    }
    template: {
      containers: [
        {
          name: 'web'
          image: webImage
          env: [
            { name: 'API_URL', value: 'http://${api.name}' }
            { name: 'COOKIE_SECURE', value: 'true' }
          ]
          resources: { cpu: json('0.5'), memory: '1Gi' }
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 3 }
    }
  }
}

output url string = 'https://${web.properties.configuration.ingress.fqdn}'
output migrateJob string = migrate.name
