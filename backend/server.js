// Polyfill crypto for Azure SDK in Node 18
global.crypto = require('crypto');
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { checkAuth, requireRole } = require('./auth');
const { upload, handleUpload } = require('./uploadHandler');
const { handleApproval } = require('./approvalHandler');

const app = express();
app.use(cors());
app.use(express.json());

const path = require('path');

// Explicitly serve index.html for the root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// Serve the frontend dir which is bundled in the same root by our zip command
app.use(express.static(path.join(__dirname, 'frontend')));

const { checkAppVersions } = require('./version_checker');
const { getVmPowerState, startVmInstance, stopVmInstance } = require('./vmHandler');

// Apply global auth middleware except for worker, sync & VM control endpoints
app.use((req, res, next) => {
    if (req.path.match(/^\/api\/requests\/\d+\/(complete|logs|status)$/) || req.path === '/api/sync-apps' || req.path.startsWith('/api/worker-vm')) {
        return next();
    }
    return checkAuth(req, res, next);
});

// Worker VM Control Endpoints
app.get('/api/worker-vm/status', async (req, res) => {
    const status = await getVmPowerState();
    res.json({ status });
});

app.post('/api/worker-vm/start', async (req, res) => {
    const result = await startVmInstance();
    res.json(result);
});

app.post('/api/worker-vm/stop', async (req, res) => {
    const result = await stopVmInstance();
    res.json(result);
});

// Routes
// Upload route requires 'App.Uploader' role
app.post('/api/upload', requireRole('App.Uploader'), upload.single('installer'), handleUpload);

// Sync external app repositories (Winget/Evergreen)
app.post('/api/sync-apps', async (req, res) => {
    try {
        console.log('[Server] Manual external app sync triggered from UI/API');
        const dispatched = await checkAppVersions();
        if (dispatched.length > 0) {
            await startVmInstance();
        }
        res.json({ success: true, message: `Version check complete. ${dispatched.length} job(s) queued.`, dispatched });
    } catch (error) {
        console.error('[Server] Sync failed:', error);
        res.status(500).json({ error: 'Failed to sync external application versions' });
    }
});

// Schedule background version checks every 6 hours (21600000 ms)
setInterval(() => {
    console.log('[Server] Running scheduled 6-hour external app version check...');
    checkAppVersions().catch(err => console.error('[Server] Scheduled version check error:', err));
}, 6 * 60 * 60 * 1000);

// Approval route requires 'App.Approver' role
app.post('/api/requests/:requestId/approve', requireRole('App.Approver'), handleApproval);

// Completion route for the Windows Worker
app.post('/api/requests/:requestId/complete', async (req, res) => {
    const db = require('./db');
    try {
        await db.query('UPDATE requests SET status = $1 WHERE id = $2', ['Packaged', req.params.requestId]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to complete request' });
    }
});

// Status route for checking requests
app.get('/api/requests', async (req, res) => {
    const db = require('./db');
    try {
        const dbRes = await db.query('SELECT * FROM requests ORDER BY id DESC');
        res.json(dbRes.rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch requests' });
    }
});

// Logs viewing route for completed/in-progress requests
app.get('/api/requests/:requestId/logs', async (req, res) => {
    try {
        const { BlobServiceClient } = require('@azure/storage-blob');
        const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
        const containerClient = blobServiceClient.getContainerClient('uploads');

        const reqId = req.params.requestId;
        let blobName = `logs/${reqId}.log`;
        let blockBlobClient = containerClient.getBlockBlobClient(blobName);

        let exists = await blockBlobClient.exists();
        if (!exists) {
            // Precise Regex Search for exact logs/<reqId>.log or logs/<reqId>_*.log
            const exactPattern = new RegExp(`^logs/${reqId}(\\.|_|$)`);
            for await (const blob of containerClient.listBlobsFlat({ prefix: `logs/` })) {
                if (exactPattern.test(blob.name)) {
                    blobName = blob.name;
                    blockBlobClient = containerClient.getBlockBlobClient(blobName);
                    exists = true;
                    break;
                }
            }
        }

        if (!exists) {
            return res.status(404).send(`Log file for Request #${reqId} not found in Azure Storage. The worker VM may still be processing this request.`);
        }

        const downloadResponse = await blockBlobClient.download(0);
        const downloaded = await streamToBuffer(downloadResponse.readableStreamBody);

        // Prevent browser caching of log responses
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        // Return raw text
        res.type('text/plain');
        res.send(downloaded.toString());
    } catch (error) {
        console.error('Error fetching logs:', error);
        res.status(500).send('Error fetching log output from Azure Storage.');
    }
});

// App Catalog route
app.get('/api/apps', (req, res) => {
    try {
        const appsPath = path.join(__dirname, 'apps.json');
        if (require('fs').existsSync(appsPath)) {
            res.sendFile(appsPath);
        } else {
            res.json([]);
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch apps catalog' });
    }
});

// App Config Route (fetches latest AppDataConfig.json for an app)
app.get('/api/apps/:appId/config', async (req, res) => {
    try {
        const { BlobServiceClient } = require('@azure/storage-blob');
        const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
        const containerClient = blobServiceClient.getContainerClient('uploads');

        const appPrefix = `${req.params.appId}/`;
        let latestConfigBlob = null;

        // Find the most recent config blob (since old versions are deleted on upload, technically there should only be one)
        for await (const blob of containerClient.listBlobsFlat({ prefix: appPrefix })) {
            if (blob.name.endsWith(`AppDataConfig-${req.params.appId}.json`)) {
                latestConfigBlob = blob.name;
                break;
            }
        }

        if (latestConfigBlob) {
            const blockBlobClient = containerClient.getBlockBlobClient(latestConfigBlob);
            const downloadBlockBlobResponse = await blockBlobClient.download(0);

            const downloaded = await streamToBuffer(downloadBlockBlobResponse.readableStreamBody);
            res.json(JSON.parse(downloaded.toString()));
        } else {
            res.status(404).json({ message: 'No configuration found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch configuration' });
    }
});

// Helper for Azure Blob streams
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

app.get('/api/debug', (req, res) => {
    const fs = require('fs');
    res.json({
        cwd: process.cwd(),
        dirname: __dirname,
        frontendDir: path.join(__dirname, 'frontend'),
        frontendExists: fs.existsSync(path.join(__dirname, 'frontend')),
        frontendFiles: fs.existsSync(path.join(__dirname, 'frontend')) ? fs.readdirSync(path.join(__dirname, 'frontend')) : []
    });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`Backend API running on port ${PORT} bound to 0.0.0.0`));
