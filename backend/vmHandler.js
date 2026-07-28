const axios = require('axios');

const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID || '02665267-e404-4631-9144-e0de49d513f4';
const resourceGroup = process.env.AZURE_RESOURCE_GROUP || 'Packemon';
const vmName = process.env.AZURE_VM_NAME || 'apppkg-dev-vm';

async function getAccessToken() {
    try {
        const msiEndpoint = process.env.IDENTITY_ENDPOINT || process.env.MSI_ENDPOINT;
        const msiHeader = process.env.IDENTITY_HEADER || process.env.MSI_SECRET;

        if (msiEndpoint && msiHeader) {
            const tokenRes = await axios.get(`${msiEndpoint}?resource=https://management.azure.com/&api-version=2019-08-01`, {
                headers: { 'X-IDENTITY-HEADER': msiHeader, 'Secret': msiHeader },
                timeout: 4000
            });
            if (tokenRes.data && tokenRes.data.access_token) {
                return tokenRes.data.access_token;
            }
        }

        const { DefaultAzureCredential } = require('@azure/identity');
        const credential = new DefaultAzureCredential();
        const tokenResponse = await credential.getToken('https://management.azure.com/.default');
        return tokenResponse ? tokenResponse.token : null;
    } catch (err) {
        console.error('[vmHandler] Token fetch error:', err.message);
        return null;
    }
}

async function getVmPowerState() {
    try {
        const token = await getAccessToken();
        if (!token) return 'VM Unknown';
        
        const url = `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/virtualMachines/${vmName}/instanceView?api-version=2023-09-01`;
        const response = await axios.get(url, {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 5000
        });
        
        const statuses = response.data?.statuses || [];
        const powerState = statuses.find(s => s.code && s.code.startsWith('PowerState/'));
        return powerState ? powerState.displayStatus : 'VM Unknown';
    } catch (err) {
        console.error('[vmHandler] getVmPowerState error:', err.message);
        return 'VM Unknown';
    }
}

async function startVmInstance() {
    try {
        console.log(`[vmHandler] Requesting start for VM ${vmName}...`);
        const token = await getAccessToken();
        if (!token) return { success: false, error: 'Failed to acquire Azure token' };
        
        const url = `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/virtualMachines/${vmName}/start?api-version=2023-09-01`;
        await axios.post(url, {}, {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 8000
        });
        
        console.log(`[vmHandler] VM ${vmName} start command issued successfully.`);
        return { success: true };
    } catch (err) {
        console.error('[vmHandler] startVmInstance error:', err.message);
        return { success: false, error: err.message };
    }
}

async function stopVmInstance() {
    try {
        console.log(`[vmHandler] Requesting deallocate for VM ${vmName}...`);
        const token = await getAccessToken();
        if (!token) return { success: false, error: 'Failed to acquire Azure token' };
        
        const url = `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroup}/providers/Microsoft.Compute/virtualMachines/${vmName}/deallocate?api-version=2023-09-01`;
        await axios.post(url, {}, {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 8000
        });
        
        console.log(`[vmHandler] VM ${vmName} deallocate command issued successfully.`);
        return { success: true };
    } catch (err) {
        console.error('[vmHandler] stopVmInstance error:', err.message);
        return { success: false, error: err.message };
    }
}

module.exports = { getVmPowerState, startVmInstance, stopVmInstance };
