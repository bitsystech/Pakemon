param location string
param serverName string
param adminUsername string
@secure()
param adminPassword string
param subnetId string
param vnetId string

resource dnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: '${serverName}.private.postgres.database.azure.com'
  location: 'global'
}

resource dnsZoneLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: dnsZone
  name: '${serverName}-link'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnetId
    }
  }
}

resource pgServer 'Microsoft.DBforPostgreSQL/flexibleServers@2023-03-01-preview' = {
  name: serverName
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '15'
    administratorLogin: adminUsername
    administratorLoginPassword: adminPassword
    network: {
      delegatedSubnetResourceId: subnetId
      privateDnsZoneArmResourceId: dnsZone.id
    }
    storage: {
      storageSizeGB: 32
    }
  }
  dependsOn: [
    dnsZoneLink
  ]
}

resource pgDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-03-01-preview' = {
  parent: pgServer
  name: 'packaging_db'
  properties: {
    charset: 'utf8'
    collation: 'en_US.utf8'
  }
}

output serverFqdn string = pgServer.properties.fullyQualifiedDomainName
