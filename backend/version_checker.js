require('dotenv').config();
const { QueueClient } = require('@azure/storage-queue');
const db = require('./db');

// Supported onboarded applications and their source definitions (Winget / Evergreen)
const ONBOARDED_APPS = [
    { appId: 'MozillaFirefox', packageId: 'Mozilla.Firefox', sourceType: 'winget', defaultPublisher: 'Mozilla' },
    { appId: 'VLC', packageId: 'VideoLAN.VLC', sourceType: 'winget', defaultPublisher: 'VideoLAN' },
    { appId: '7Zip', packageId: '7zip.7zip', sourceType: 'winget', defaultPublisher: 'Igor Pavlov' },
    { appId: 'SAPGUI', packageId: 'SAPGUI.Desktop', sourceType: 'evergreen', defaultPublisher: 'SAP' }
];

async function getIntuneAppVersions() {
    console.log('[VersionChecker] Querying Intune for current app versions...');
    // In production, this queries Microsoft Graph API
    return [
        { appId: 'MozillaFirefox', version: '128.0.0' },
        { appId: 'VLC', version: '3.0.18' },
        { appId: '7Zip', version: '23.01' },
        { appId: 'SAPGUI', version: '8.0.0' }
    ];
}

async function getExternalAppVersions() {
    console.log('[VersionChecker] Querying Winget / Evergreen for available versions...');
    // Simulated latest versions available in public repositories
    return [
        { appId: 'MozillaFirefox', version: '130.0.0', packageId: 'Mozilla.Firefox', sourceType: 'winget' },
        { appId: 'VLC', version: '3.0.20', packageId: 'VideoLAN.VLC', sourceType: 'winget' },
        { appId: '7Zip', version: '24.07', packageId: '7zip.7zip', sourceType: 'winget' },
        { appId: 'SAPGUI', version: '8.0.0', packageId: 'SAPGUI.Desktop', sourceType: 'evergreen' }
    ];
}

async function queuePackageJob(appMeta) {
    console.log(`[VersionChecker] Queueing automated packaging job for ${appMeta.appId} v${appMeta.version}`);
    
    // Create request in DB with Auto-Approved status
    const dbRes = await db.query(
        'INSERT INTO requests (app_name, version, status, submitter) VALUES ($1, $2, $3, $4) RETURNING id',
        [appMeta.appId, appMeta.version, 'Approved', 'VersionCheckerBot']
    );
    const requestId = dbRes.rows[0].id;

    if (!process.env.AZURE_STORAGE_CONNECTION_STRING) {
        console.log(`[VersionChecker] Storage string missing. Mock created Request #${requestId}`);
        return { requestId, appId: appMeta.appId, version: appMeta.version, queued: false };
    }

    const { BlobServiceClient } = require('@azure/storage-blob');
    const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
    const containerClient = blobServiceClient.getContainerClient('uploads');

    let masterTemplate = {};
    try {
        const masterBlobClient = containerClient.getBlockBlobClient(`templates/${appMeta.appId}/config.json`);
        if (await masterBlobClient.exists()) {
            const downloadRes = await masterBlobClient.download(0);
            const chunks = [];
            for await (const chunk of downloadRes.readableStreamBody) {
                chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk));
            }
            masterTemplate = JSON.parse(Buffer.concat(chunks).toString());
            console.log(`[VersionChecker] Loaded master template for ${appMeta.appId}`);
        }
    } catch (tErr) {
        console.log(`[VersionChecker] No existing master template for ${appMeta.appId}, generating default config.`);
    }

    const configData = {
        ...masterTemplate,
        requestId: requestId,
        appName: appMeta.appId,
        version: appMeta.version,
        sourceType: appMeta.sourceType,
        packageId: appMeta.packageId,
        AppInformation_ApplicationName: appMeta.appId,
        AppInformation_Version: appMeta.version
    };

    const readyBlobName = `system/${requestId}_ready.json`;
    const blockBlobClient = containerClient.getBlockBlobClient(readyBlobName);
    const configBuffer = Buffer.from(JSON.stringify(configData, null, 2));
    await blockBlobClient.upload(configBuffer, configBuffer.length);

    const { dispatchJob } = require('./pipeline_dispatcher');

    const messagePayload = {
        requestId: requestId,
        appName: appMeta.appId,
        version: appMeta.version,
        sourceType: appMeta.sourceType,
        packageId: appMeta.packageId,
        source: 'AutomatedVersionChecker',
        readyBlobPath: readyBlobName
    };

    const dispatchRes = await dispatchJob(messagePayload);
    console.log(`[VersionChecker] Successfully dispatched job #${requestId} via ${dispatchRes.provider}`);
    return { requestId, appId: appMeta.appId, version: appMeta.version, queued: dispatchRes.success };
}

async function checkAppVersions() {
    console.log('[VersionChecker] Starting automated version sync cycle...');
    const dispatched = [];

    try {
        const intuneApps = await getIntuneAppVersions();
        const externalApps = await getExternalAppVersions();

        for (const extApp of externalApps) {
            const intuneApp = intuneApps.find(a => a.appId === extApp.appId);

            if (!intuneApp || intuneApp.version !== extApp.version) {
                console.log(`[VersionChecker] Update found for ${extApp.appId}: Intune v${intuneApp ? intuneApp.version : 'None'} -> External v${extApp.version}`);
                const result = await queuePackageJob(extApp);
                dispatched.push(result);
            } else {
                console.log(`[VersionChecker] ${extApp.appId} is up to date (v${extApp.version})`);
            }
        }
    } catch (err) {
        console.error('[VersionChecker] Error during version check:', err);
    }
    
    return dispatched;
}

// Allow execution from CLI or via require module
if (require.main === module) {
    checkAppVersions().then(() => process.exit(0));
}

module.exports = { checkAppVersions, ONBOARDED_APPS };
