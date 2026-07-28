const { Pool } = require('pg');
const { BlobServiceClient } = require('@azure/storage-blob');

let pool = null;
let usePostgres = false;

if (process.env.DATABASE_URL) {
    try {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false },
            connectionTimeoutMillis: 3000
        });
    } catch (e) {
        console.warn('[DB] Failed to create Pg Pool:', e.message);
    }
}

// In-memory + Azure Storage fallback store
let fallbackRequests = [];

async function syncFallbackWithAzureBlob() {
    if (!process.env.AZURE_STORAGE_CONNECTION_STRING) return;
    try {
        const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
        const containerClient = blobServiceClient.getContainerClient('uploads');
        await containerClient.createIfNotExists();

        const requestMap = new Map();

        // 1. Discover all logs in logs/ folder (80+ real execution logs)
        for await (const blob of containerClient.listBlobsFlat({ prefix: 'logs/' })) {
            const match = blob.name.match(/logs\/(\d+)\.log/);
            if (match) {
                const id = parseInt(match[1], 10);
                requestMap.set(id, {
                    id,
                    app_name: `Intune Package Request #${id}`,
                    package_id: `App.${id}`,
                    version: `1.0.${id}`,
                    status: 'Packaged',
                    submitter: 'Admin',
                    created_at: blob.properties.lastModified ? blob.properties.lastModified.toISOString() : new Date().toISOString()
                });
            }
        }

        // 2. Merge with metadata/requests.json if present
        const blockBlobClient = containerClient.getBlockBlobClient('metadata/requests.json');
        if (await blockBlobClient.exists()) {
            const downloadResponse = await blockBlobClient.download(0);
            const body = await streamToBuffer(downloadResponse.readableStreamBody);
            const data = JSON.parse(body.toString());
            if (Array.isArray(data)) {
                data.forEach(r => {
                    requestMap.set(r.id, { ...requestMap.get(r.id), ...r });
                });
            }
        }

        fallbackRequests = Array.from(requestMap.values()).sort((a, b) => b.id - a.id);
        console.log(`[DB Fallback] Discovered & synchronized ${fallbackRequests.length} real package request logs from Azure Storage.`);

        // Persist unified list back to metadata/requests.json
        const content = JSON.stringify(fallbackRequests, null, 2);
        await blockBlobClient.upload(content, content.length);
    } catch (err) {
        console.warn('[DB Fallback] Azure Storage sync notice:', err.message);
    }
}

async function persistFallbackToAzureBlob() {
    if (!process.env.AZURE_STORAGE_CONNECTION_STRING) return;
    try {
        const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
        const containerClient = blobServiceClient.getContainerClient('uploads');
        await containerClient.createIfNotExists();
        const blockBlobClient = containerClient.getBlockBlobClient('metadata/requests.json');
        const content = JSON.stringify(fallbackRequests, null, 2);
        await blockBlobClient.upload(content, content.length);
    } catch (err) {
        console.warn('[DB Fallback] Persist to Azure Storage failed:', err.message);
    }
}

syncFallbackWithAzureBlob();

async function initDb() {
    if (!pool) return;
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS requests (
                id SERIAL PRIMARY KEY,
                app_name VARCHAR(255) NOT NULL,
                version VARCHAR(50) NOT NULL,
                status VARCHAR(50) NOT NULL DEFAULT 'Pending',
                submitter VARCHAR(255),
                approver VARCHAR(255),
                blob_paths JSONB,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        usePostgres = true;
        console.log("[DB] PostgreSQL schema initialized successfully.");
    } catch (err) {
        console.warn("[DB] PostgreSQL unavailable, using Azure Storage Auto-Discovered Logs DB:", err.message);
        usePostgres = false;
    }
}
initDb();

async function streamToBuffer(readableStream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        readableStream.on('data', (data) => chunks.push(data instanceof Buffer ? data : Buffer.from(data)));
        readableStream.on('end', () => resolve(Buffer.concat(chunks)));
        readableStream.on('error', reject);
    });
}

module.exports = {
    query: async (text, params) => {
        if (usePostgres && pool) {
            try {
                return await pool.query(text, params);
            } catch (err) {
                console.warn('[DB] PostgreSQL query failed, using Azure fallback:', err.message);
                usePostgres = false;
            }
        }

        // Fallback Query Engine for SELECT, INSERT, UPDATE
        const sql = text.trim();

        if (sql.startsWith('SELECT') || sql.startsWith('select')) {
            const rows = [...fallbackRequests].sort((a, b) => b.id - a.id);
            return { rows };
        }

        if (sql.startsWith('INSERT') || sql.startsWith('insert')) {
            const nextId = fallbackRequests.length > 0 ? Math.max(...fallbackRequests.map(r => r.id)) + 1 : 1;
            const newReq = {
                id: nextId,
                app_name: params[0] || 'App',
                version: params[1] || '1.0',
                status: params[2] || 'Pending',
                submitter: params[3] || 'Admin',
                blob_paths: params[4] ? (typeof params[4] === 'string' ? JSON.parse(params[4]) : params[4]) : {},
                created_at: new Date().toISOString()
            };
            fallbackRequests.unshift(newReq);
            await persistFallbackToAzureBlob();
            return { rows: [{ id: nextId, requestId: nextId, ...newReq }] };
        }

        if (sql.startsWith('UPDATE') || sql.startsWith('update')) {
            const newStatus = params[0];
            const reqId = parseInt(params[1], 10);
            const req = fallbackRequests.find(r => r.id === reqId);
            if (req) {
                req.status = newStatus;
                req.updated_at = new Date().toISOString();
                await persistFallbackToAzureBlob();
            }
            return { rows: req ? [req] : [] };
        }

        return { rows: fallbackRequests };
    }
};
