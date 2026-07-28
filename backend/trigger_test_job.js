require('dotenv').config();
const { QueueClient } = require('@azure/storage-queue');
const { BlobServiceClient } = require('@azure/storage-blob');

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;

async function triggerWingetJob() {
    try {
        const requestId = 100;
        const appName = "MozillaFirefox";
        const version = "125.0";
        const readyBlobPath = `system/${requestId}_ready.json`;

        console.log(`Setting up _ready.json for Winget Test Request #${requestId}...`);
        const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
        const containerClient = blobServiceClient.getContainerClient('uploads');
        const blockBlobClient = containerClient.getBlockBlobClient(readyBlobPath);

        const readyConfig = {
            requestId: requestId,
            appName: appName,
            version: version,
            sourceType: "winget",
            packageId: "Mozilla.Firefox",
            AppInformation_ApplicationName: appName,
            AppInformation_Version: version
        };

        await blockBlobClient.uploadData(Buffer.from(JSON.stringify(readyConfig)));
        console.log(`Uploaded ${readyBlobPath}`);

        console.log(`Sending job message to Azure Storage Queue "package-jobs"...`);
        const queueClient = new QueueClient(connectionString, 'package-jobs');
        await queueClient.createIfNotExists();

        const messageText = JSON.stringify({
            requestId: requestId,
            readyBlobPath: readyBlobPath,
            appName: appName,
            version: version,
            sourceType: "winget",
            packageId: "Mozilla.Firefox"
        });

        await queueClient.sendMessage(Buffer.from(messageText).toString('base64'));
        console.log(`✅ Successfully queued Winget job for Request #${requestId}!`);
    } catch (err) {
        console.error('Error triggering job:', err);
    }
}

triggerWingetJob();
