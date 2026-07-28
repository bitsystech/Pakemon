const { BlobServiceClient } = require('@azure/storage-blob');
require('dotenv').config();

async function run() {
    try {
        const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
        const containerClient = blobServiceClient.getContainerClient('uploads');

        const pathsToCheck = [
            'Google Chrome Setup/100.1/_ready.json',
            'CurlTest2/1.0/_ready.json',
            'google-chrome/112.125/_ready.json',
            'google-chrome/112.143/_ready.json'
        ];

        for (const readyBlobPath of pathsToCheck) {
            try {
                const blockBlobClient = containerClient.getBlockBlobClient(readyBlobPath);
                const downloadResponse = await blockBlobClient.download(0);
                const downloaded = await streamToBuffer(downloadResponse.readableStreamBody);
                console.log(`\n--- ${readyBlobPath} ---`);
                console.log(downloaded.toString());
            } catch (err) {
                console.log(`Failed to download ${readyBlobPath}:`, err.message);
            }
        }
    } catch (e) {
        console.error(e);
    }
}

async function streamToBuffer(readableStream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        readableStream.on("data", (data) => chunks.push(Buffer.from(data)));
        readableStream.on("end", () => resolve(Buffer.concat(chunks)));
        readableStream.on("error", reject);
    });
}

run();
