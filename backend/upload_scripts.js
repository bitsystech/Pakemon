require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { BlobServiceClient } = require('@azure/storage-blob');

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;

async function uploadAllScripts() {
    try {
        const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
        const containerClient = blobServiceClient.getContainerClient('scripts');
        await containerClient.createIfNotExists();

        const filesToUpload = [
            { local: '../worker/process_queue.ps1', blobName: 'process_queue.ps1' },
            { local: '../patch_vm.ps1', blobName: 'patch_vm.ps1' },
            { local: '../MozillaFirefox.ps1', blobName: 'MozillaFirefox.ps1' },
            { local: '../VLC.ps1', blobName: 'VLC.ps1' },
            { local: '../SAPGUI.ps1', blobName: 'SAPGUI.ps1' }
        ];

        for (const fileItem of filesToUpload) {
            const filePath = path.join(__dirname, fileItem.local);
            if (fs.existsSync(filePath)) {
                const fileContent = fs.readFileSync(filePath);
                const blockBlobClient = containerClient.getBlockBlobClient(fileItem.blobName);
                console.log(`Uploading ${fileItem.blobName} to "scripts" container...`);
                await blockBlobClient.upload(fileContent, fileContent.length);
            }
        }
        console.log('✅ Successfully uploaded all scripts (including patch_vm.ps1 and process_queue.ps1) to Azure Storage!');
    } catch (err) {
        console.error('Error uploading scripts:', err);
        process.exit(1);
    }
}

uploadAllScripts();
