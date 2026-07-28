const multer = require('multer');
const { BlobServiceClient } = require('@azure/storage-blob');
const db = require('./db');
const { sendTeamsNotification } = require('./teamsIntegration');

const fs = require('fs');
const os = require('os');
const path = require('path');

// Multer setup for disk storage (to support large 1GB files without crashing RAM)
const uploadDir = path.join(os.tmpdir(), 'packemon-uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => cb(null, file.originalname)
});
// Limit mapped to 1 Gigabyte
const upload = multer({ storage: storage, limits: { fileSize: 1024 * 1024 * 1024 } });

async function handleUpload(req, res) {
    try {
        const { appName, version, config } = req.body;
        const file = req.file;

        if (!appName || !version || !file) {
            return res.status(400).json({ error: 'appName, version, and file are required' });
        }

        // Parse the extended configuration JSON
        let appConfig = {};
        if (config) {
            try {
                appConfig = JSON.parse(config);
            } catch (e) {
                console.warn("Failed to parse config JSON");
            }
        }

        // 1. Insert into DB early to get an ID and return
        const dbRes = await db.query(
            `INSERT INTO requests (app_name, version, status, submitter, blob_paths) 
       VALUES ($1, $2, 'Uploading', $3, $4) RETURNING id`,
            [appName, version, req.user.name, JSON.stringify(["Pending"])]
        );
        const requestId = dbRes.rows[0].id;
        res.json({ message: 'Upload received, processing in background...', requestId });

        // 2. Upload to Blob Storage (Background)
        (async () => {
            try {
                const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
                const containerClient = blobServiceClient.getContainerClient('uploads');
                await containerClient.createIfNotExists();

                const appPrefix = `${appName}/`;
                for await (const blob of containerClient.listBlobsFlat({ prefix: appPrefix })) {
                    if (!blob.name.startsWith(`${appName}/${version}/`)) {
                        console.log(`Deleting older version blob: ${blob.name}`);
                        await containerClient.getBlockBlobClient(blob.name).delete();
                    }
                }

                const blobPath = `${appName}/${version}/${file.originalname}`;
                const blockBlobClient = containerClient.getBlockBlobClient(blobPath);
                await blockBlobClient.uploadFile(file.path);

                const configBlobPath = `${appName}/${version}/AppDataConfig-${appName}.json`;
                const configBlockBlobClient = containerClient.getBlockBlobClient(configBlobPath);
                await configBlockBlobClient.uploadData(Buffer.from(JSON.stringify(appConfig, null, 2)));

                // Also save master template for future automated version updates
                const masterTemplatePath = `templates/${appName}/config.json`;
                const masterBlobClient = containerClient.getBlockBlobClient(masterTemplatePath);
                await masterBlobClient.uploadData(Buffer.from(JSON.stringify(appConfig, null, 2)));

                fs.unlinkSync(file.path);

                // Update DB and Notify
                await db.query(`UPDATE requests SET status = 'Pending', blob_paths = $1 WHERE id = $2`, [JSON.stringify([blobPath]), requestId]);
                await sendTeamsNotification(`🚀 New Package Request #${requestId}: ${appName} v${version} submitted by ${req.user.name} and is pending approval.`);
            } catch (bgError) {
                console.error('Background Upload Error:', bgError);
                await db.query(`UPDATE requests SET status = 'Failed' WHERE id = $1`, [requestId]);
            }
        })();
    } catch (error) {
        console.error('Upload Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

module.exports = { upload, handleUpload };
