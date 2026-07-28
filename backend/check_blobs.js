require('dotenv').config();
const { BlobServiceClient } = require('@azure/storage-blob');

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;

async function checkLogs() {
    try {
        const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
        const containerClient = blobServiceClient.getContainerClient('uploads');

        console.log('Listing blobs in "uploads" container...');
        for await (const blob of containerClient.listBlobsFlat()) {
            console.log(` - ${blob.name} (${blob.properties.contentLength} bytes, modified: ${blob.properties.lastModified})`);
        }
    } catch (err) {
        console.error('Error listing blobs:', err);
    }
}

checkLogs();
