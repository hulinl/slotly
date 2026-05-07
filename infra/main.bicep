// Slotly Phase-1 production stack — single Bicep, single resource group.
//
// Provisions:
//   - PostgreSQL Flexible Server B1ms (managed, public access)
//   - Azure Container Registry Basic (private images)
//   - Container Apps environment + one Container App (backend)
//   - Static Web App (frontend, Free tier, GitHub deploy)
//   - Communication Services + Email Communication Service (transactional email,
//     using the Azure-managed sender domain for now)
//
// Idempotent: re-running with the same parameters updates in place.

@description('Azure region for everything.')
param location string = resourceGroup().location

@description('Postgres admin login.')
param postgresAdmin string = 'slotlyadmin'

@secure()
@description('Postgres admin password (must satisfy MS complexity rules).')
param postgresPassword string

@description('Database name created on the server.')
param postgresDatabase string = 'slotly'

@secure()
@description('Django SECRET_KEY (generate before deploying).')
param djangoSecretKey string

@secure()
@description('Calendar URL encryption key (32-byte url-safe base64 — see PRD §5.2).')
param calendarUrlEncryptionKey string

@description('Public origin where the frontend is served (canonical, used for email links + CORS).')
param frontendBaseUrl string = 'https://www.slotly.team'

@description('Comma-separated list of allowed CORS origins / CSRF trusted origins. Defaults to apex + www so a webglobe URL redirect from apex still passes CSRF.')
param frontendAllowedOrigins string = 'https://www.slotly.team,https://slotly.team'

@description('GitHub repo URL for Static Web Apps source.')
param githubRepo string = 'https://github.com/hulinl/slotly'

@description('Branch Static Web Apps deploys from.')
param githubBranch string = 'main'

@description('GitHub PAT with repo + workflow scopes. Pass empty to skip SWA provisioning and create it separately later.')
@secure()
param githubToken string = ''

@description('Initial container image for the backend Container App. Defaults to a placeholder so the resource creates successfully on a fresh ACR; deploy.sh release swaps it for the real one.')
param backendInitialImage string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

// ---------------------------------------------------------------------------
// Globally-unique name suffix
// ---------------------------------------------------------------------------
var suffix = take(uniqueString(resourceGroup().id), 6)

var pgServerName = 'slotly-pg-${suffix}'
var acrName = 'slotlyacr${suffix}'
var caEnvName = 'slotly-env'
var caBackendName = 'slotly-backend'
var swaName = 'slotly-frontend'
var commName = 'slotly-comm'
var emailServiceName = 'slotly-email'

// ===========================================================================
// PostgreSQL Flexible Server (B1ms — cheapest managed tier)
// ===========================================================================
resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: pgServerName
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: postgresAdmin
    administratorLoginPassword: postgresPassword
    storage: {
      storageSizeGB: 32
      autoGrow: 'Disabled'
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
  }
}

// Open public network for the entire Azure cloud (Container Apps egress is
// dynamic, so a tighter VNET rule needs a managed env with VNET injection).
resource pgFirewallAzure 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: postgres
  name: 'allow-azure-services'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource pgDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  parent: postgres
  name: postgresDatabase
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

// ===========================================================================
// Azure Container Registry (Basic ~ €4/mo)
// ===========================================================================
resource acr 'Microsoft.ContainerRegistry/registries@2023-11-01-preview' = {
  name: acrName
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: true
  }
}

// ===========================================================================
// Communication Services + Email Service (managed sender domain)
// ===========================================================================
resource emailService 'Microsoft.Communication/EmailServices@2023-04-01' = {
  name: emailServiceName
  location: 'global'
  properties: {
    dataLocation: 'Europe'
  }
}

resource emailDomain 'Microsoft.Communication/EmailServices/Domains@2023-04-01' = {
  parent: emailService
  name: 'AzureManagedDomain'
  location: 'global'
  properties: {
    domainManagement: 'AzureManaged'
    userEngagementTracking: 'Disabled'
  }
}

// Customer-managed sender domain. Created in pending-verification state;
// after the user adds the DNS records that Azure exposes via this resource's
// `verificationRecords` property, run InitiateVerification to flip it Verified.
resource emailCustomDomain 'Microsoft.Communication/EmailServices/Domains@2023-04-01' = {
  parent: emailService
  name: 'slotly.team'
  location: 'global'
  properties: {
    domainManagement: 'CustomerManaged'
    userEngagementTracking: 'Disabled'
  }
}

// noreply@slotly.team sender. Resource creation only succeeds after the
// parent domain finishes verification.
resource noreplySender 'Microsoft.Communication/EmailServices/Domains/SenderUsernames@2023-04-01' = {
  parent: emailCustomDomain
  name: 'noreply'
  properties: {
    username: 'noreply'
    displayName: 'Slotly'
  }
}

// Communication Service must explicitly link to each Email Domain it can
// send from. Otherwise sends fail with "DomainNotLinked".
resource comm 'Microsoft.Communication/CommunicationServices@2023-04-01' = {
  name: commName
  location: 'global'
  properties: {
    dataLocation: 'Europe'
    linkedDomains: [
      emailDomain.id
      emailCustomDomain.id
    ]
  }
}

// ===========================================================================
// Container Apps environment + backend app
// ===========================================================================
resource caEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: caEnvName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'azure-monitor'
    }
  }
}

resource caBackend 'Microsoft.App/containerApps@2024-03-01' = {
  name: caBackendName
  location: location
  properties: {
    managedEnvironmentId: caEnv.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8000
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        {
          server: acr.properties.loginServer
          username: acr.listCredentials().username
          passwordSecretRef: 'acr-password'
        }
      ]
      secrets: [
        {
          name: 'acr-password'
          value: acr.listCredentials().passwords[0].value
        }
        {
          name: 'django-secret'
          value: djangoSecretKey
        }
        {
          name: 'pg-url'
          value: 'postgres://${postgresAdmin}:${postgresPassword}@${postgres.properties.fullyQualifiedDomainName}:5432/${postgresDatabase}?sslmode=require'
        }
        {
          name: 'cal-key'
          value: calendarUrlEncryptionKey
        }
        {
          name: 'acs-conn'
          value: comm.listKeys().primaryConnectionString
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'django'
          // First-run placeholder so the resource creates before the real
          // image exists in ACR. deploy.sh release swaps to the real one.
          image: backendInitialImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            { name: 'DJANGO_SETTINGS_MODULE', value: 'slotly_api.settings_prod' }
            { name: 'DJANGO_DEBUG', value: 'False' }
            { name: 'DJANGO_ALLOWED_HOSTS', value: 'api.slotly.team,${caBackendName}.${caEnv.properties.defaultDomain}' }
            { name: 'FRONTEND_BASE_URL', value: frontendBaseUrl }
            { name: 'CORS_ALLOWED_ORIGINS', value: frontendAllowedOrigins }
            { name: 'CSRF_TRUSTED_ORIGINS', value: frontendAllowedOrigins }
            { name: 'DJANGO_SECRET_KEY', secretRef: 'django-secret' }
            { name: 'DATABASE_URL', secretRef: 'pg-url' }
            { name: 'CALENDAR_URL_ENCRYPTION_KEY', secretRef: 'cal-key' }
            { name: 'AZURE_COMMUNICATION_CONNECTION_STRING', secretRef: 'acs-conn' }
            { name: 'DEFAULT_FROM_EMAIL', value: 'Slotly <noreply@slotly.team>' }
          ]
        }
      ]
      scale: {
        minReplicas: 1   // keep one warm so first request after idle isn't a 30s cold start
        maxReplicas: 3
      }
    }
  }
  dependsOn: [
    pgDatabase
    pgFirewallAzure
  ]
}

// ===========================================================================
// Static Web Apps (Free tier — frontend)
// Only created when a GitHub token is provided. Otherwise we'll create it
// separately after capturing the token (e.g. via az staticwebapp create).
// ===========================================================================
resource swa 'Microsoft.Web/staticSites@2023-12-01' = if (!empty(githubToken)) {
  name: swaName
  location: 'westeurope'
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    repositoryUrl: githubRepo
    branch: githubBranch
    repositoryToken: githubToken
    buildProperties: {
      appLocation: '/frontend'
      apiLocation: ''
      outputLocation: '.next'
    }
  }
}

// ===========================================================================
// Azure DNS — owns slotly.team. Registration stays at webglobe; we just
// move the NS records there to point at Azure DNS so we can use ALIAS at
// apex (the only Azure-supported way to put a Static Web App on the apex).
// ===========================================================================
@description('SWA validation token for apex slotly.team (TXT _dnsauth). Re-run az staticwebapp hostname show to refresh.')
param swaApexValidationToken string = '_k0fptuhbwrdb004kl7pisaf70v8c12q'

@description('SWA validation token for www.slotly.team (TXT _dnsauth.www).')
param swaWwwValidationToken string = '_j5og1lp7t3d7gye1pfw7tpsehqrjgyz'

@description('Container App env customDomainVerificationId (TXT asuid.api).')
param caBackendVerificationId string = '11E901F8148387D9CC9786CD5B79BD7F096D4471C57C8A64EE778E84E5D99E21'

@description('ACS slotly.team domain ownership token (TXT @, ms-domain-verification=<this>).')
param acsDomainVerificationId string = '6334de67-0a6e-488f-87c6-e2f113279db0'

resource dnsZone 'Microsoft.Network/dnsZones@2018-05-01' = {
  name: 'slotly.team'
  location: 'global'
  properties: {
    zoneType: 'Public'
  }
}

// --- Apex ALIAS to the Static Web App resource. This is what makes
// https://slotly.team possible without a third-party DNS provider.
resource apexAlias 'Microsoft.Network/dnsZones/A@2018-05-01' = if (!empty(githubToken)) {
  parent: dnsZone
  name: '@'
  properties: {
    TTL: 3600
    targetResource: {
      id: swa.id
    }
  }
}

// --- Apex TXT: ACS domain verification + SPF. Two record values, one set.
resource apexTxt 'Microsoft.Network/dnsZones/TXT@2018-05-01' = {
  parent: dnsZone
  name: '@'
  properties: {
    TTL: 3600
    TXTRecords: [
      { value: ['ms-domain-verification=${acsDomainVerificationId}'] }
      { value: ['v=spf1 include:spf.protection.outlook.com -all'] }
    ]
  }
}

// --- Apex SWA validation
resource dnsauthApex 'Microsoft.Network/dnsZones/TXT@2018-05-01' = {
  parent: dnsZone
  name: '_dnsauth'
  properties: {
    TTL: 3600
    TXTRecords: [
      { value: [swaApexValidationToken] }
    ]
  }
}

// --- www SWA validation
resource dnsauthWww 'Microsoft.Network/dnsZones/TXT@2018-05-01' = {
  parent: dnsZone
  name: '_dnsauth.www'
  properties: {
    TTL: 3600
    TXTRecords: [
      { value: [swaWwwValidationToken] }
    ]
  }
}

// --- api Container App ownership
resource asuidApi 'Microsoft.Network/dnsZones/TXT@2018-05-01' = {
  parent: dnsZone
  name: 'asuid.api'
  properties: {
    TTL: 3600
    TXTRecords: [
      { value: [caBackendVerificationId] }
    ]
  }
}

// --- DMARC
resource dmarc 'Microsoft.Network/dnsZones/TXT@2018-05-01' = {
  parent: dnsZone
  name: '_dmarc'
  properties: {
    TTL: 3600
    TXTRecords: [
      { value: ['v=DMARC1; p=none; rua=mailto:hulin@bifactory.cz'] }
    ]
  }
}

// --- www → SWA
resource cnameWww 'Microsoft.Network/dnsZones/CNAME@2018-05-01' = if (!empty(githubToken)) {
  parent: dnsZone
  name: 'www'
  properties: {
    TTL: 3600
    CNAMERecord: {
      cname: swa.properties.defaultHostname
    }
  }
}

// --- api → Container App
resource cnameApi 'Microsoft.Network/dnsZones/CNAME@2018-05-01' = {
  parent: dnsZone
  name: 'api'
  properties: {
    TTL: 3600
    CNAMERecord: {
      cname: caBackend.properties.configuration.ingress.fqdn
    }
  }
}

// --- DKIM CNAMEs (for ACS slotly.team email)
resource dkim1 'Microsoft.Network/dnsZones/CNAME@2018-05-01' = {
  parent: dnsZone
  name: 'selector1-azurecomm-prod-net._domainkey'
  properties: {
    TTL: 3600
    CNAMERecord: {
      cname: 'selector1-azurecomm-prod-net._domainkey.azurecomm.net'
    }
  }
}

resource dkim2 'Microsoft.Network/dnsZones/CNAME@2018-05-01' = {
  parent: dnsZone
  name: 'selector2-azurecomm-prod-net._domainkey'
  properties: {
    TTL: 3600
    CNAMERecord: {
      cname: 'selector2-azurecomm-prod-net._domainkey.azurecomm.net'
    }
  }
}

// ---------------------------------------------------------------------------
// Outputs — used by deploy.sh and DNS configuration
// ---------------------------------------------------------------------------
output postgresFqdn string = postgres.properties.fullyQualifiedDomainName
output postgresDatabaseName string = postgresDatabase
output postgresAdminLogin string = postgresAdmin

output acrLoginServer string = acr.properties.loginServer
output acrName string = acr.name

output backendFqdn string = caBackend.properties.configuration.ingress.fqdn
output backendName string = caBackend.name

output staticWebHost string = empty(githubToken) ? '' : swa.properties.defaultHostname
output staticWebName string = empty(githubToken) ? '' : swa.name

output emailSenderDomain string = emailDomain.properties.fromSenderDomain
output communicationServiceName string = comm.name

output dnsZoneName string = dnsZone.name
output dnsNameServers array = dnsZone.properties.nameServers
