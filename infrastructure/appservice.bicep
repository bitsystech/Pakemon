param location string
param appServiceName string
param appServicePlanName string
param vnetSubnetId string
@secure()
param storageConnectionString string
@secure()
param dbConnectionString string
param tenantId string
param clientId string

resource appServicePlan 'Microsoft.Web/serverfarms@2022-09-01' = {
  name: appServicePlanName
  location: location
  sku: {
    name: 'B1'
    tier: 'Basic'
  }
  kind: 'linux'
  properties: {
    reserved: true
  }
}

resource appService 'Microsoft.Web/sites@2022-09-01' = {
  name: appServiceName
  location: location
  properties: {
    serverFarmId: appServicePlan.id
    virtualNetworkSubnetId: vnetSubnetId
    siteConfig: {
      linuxFxVersion: 'NODE|18-lts'
      appSettings: [
        {
          name: 'WEBSITE_NODE_DEFAULT_VERSION'
          value: '~18'
        }
        {
          name: 'DATABASE_URL'
          value: dbConnectionString
        }
        {
          name: 'AZURE_STORAGE_CONNECTION_STRING'
          value: storageConnectionString
        }
        {
          name: 'TENANT_ID'
          value: tenantId
        }
        {
          name: 'CLIENT_ID'
          value: clientId
        }
      ]
    }
  }
}
