require('dotenv').config();
const { BlobServiceClient } = require('@azure/storage-blob');

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;

async function downloadLog(logName) {
    try {
        const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
        const containerClient = blobServiceClient.getContainerClient('uploads');
        const blockBlobClient = containerClient.getBlockBlobClient(`logs/${logName}`);
        
        const downloadBlockBlobResponse = await blockBlobClient.download(0);
        const downloaded = (await streamToBuffer(downloadBlockBlobResponse.readableStreamBody)).toString();
        console.log(`--- Content of logs/${logName} ---`);
        console.log(downloaded);
    } catch (err) {
        console.error('Error downloading log:', err);
    }
}

async function streamToBuffer(readableStream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        readableStream.on("data", (data) => {
            chunks.push(data instanceof Buffer ? data : Buffer.from(data));
        });
        readableStream.on("end", () => {
            resolve(Buffer.concat(chunks));
        });
        readableStream.on("error", reject);
    });
}

downloadLog('94.log');
