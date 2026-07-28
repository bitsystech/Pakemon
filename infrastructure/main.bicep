param location string = resourceGroup().location
param environmentName string = 'dev'
param appName string = 'apppkg'
param adminUsername string = 'azureadmin'
@secure()
param adminPassword string
param tenantId string = '6400282f-d7ad-425f-b19d-a943c2538d80'
param clientId string = 'f413c96e-ca57-42d9-ad9e-932a593397a5'

var resourcePrefix = '${appName}-${environmentName}'

module network 'network.bicep' = {
  name: 'network-deployment'
  params: {
    location: location
    vnetName: '${resourcePrefix}-vnet'
  }
}

module storage 'storage.bicep' = {
  name: 'storage-deployment'
  params: {
    location: location
    storageAccountName: replace('${resourcePrefix}storage', '-', '')
  }
}

module keyvault 'keyvault.bicep' = {
  name: 'keyvault-deployment'
  params: {
    location: location
    keyVaultName: '${resourcePrefix}-kv'
    tenantId: tenantId
    adminPassword: adminPassword
    storageConnectionString: storage.outputs.storageConnectionString
  }
}

module database 'database.bicep' = {
  name: 'database-deployment'
  params: {
    location: location
    serverName: '${resourcePrefix}-pg'
    adminUsername: adminUsername
    adminPassword: adminPassword
    subnetId: network.outputs.dbSubnetId
    vnetId: network.outputs.vnetId
  }
}

module appservice 'appservice.bicep' = {
  name: 'appservice-deployment'
  params: {
    location: location
    appServiceName: '${resourcePrefix}-app'
    appServicePlanName: '${resourcePrefix}-asp'
    vnetSubnetId: network.outputs.appSubnetId
    storageConnectionString: storage.outputs.storageConnectionString
    dbConnectionString: 'postgres://${adminUsername}:${adminPassword}@${database.outputs.serverFqdn}:5432/packaging_db?sslmode=require'
    tenantId: tenantId
    clientId: clientId
  }
}

module worker 'worker.bicep' = {
  name: 'worker-deployment'
  params: {
    location: location
    vmName: '${resourcePrefix}-vm'
    adminUsername: adminUsername
    adminPassword: adminPassword
    subnetId: network.outputs.vmSubnetId
    storageConnectionString: storage.outputs.storageConnectionString
  }
}
