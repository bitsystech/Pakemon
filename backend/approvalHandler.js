const { QueueClient } = require('@azure/storage-queue');
const { BlobServiceClient } = require('@azure/storage-blob');
const db = require('./db');
const { sendTeamsNotification } = require('./teamsIntegration');
const { startVmInstance } = require('./vmHandler');

async function handleApproval(req, res) {
    try {
        const { requestId } = req.params;
        const { action } = req.body; // 'Approve' or 'Reject'

        if (action !== 'Approve' && action !== 'Reject') {
            return res.status(400).json({ error: 'Action must be Approve or Reject' });
        }

        const newStatus = action === 'Approve' ? 'Approved' : 'Rejected';

        // Update DB
        const dbRes = await db.query(
            `UPDATE requests SET status = $1, approver = $2 WHERE id = $3 RETURNING *`,
            [newStatus, req.user.name, requestId]
        );

        if (dbRes.rowCount === 0) {
            return res.status(404).json({ error: 'Request not found' });
        }

        const request = dbRes.rows[0];

        await sendTeamsNotification(`✅ Package Request #${request.id} for ${request.app_name} v${request.version} was ${newStatus} by ${req.user.name}.`);

        if (newStatus === 'Approved') {
            // Create _ready.json in Blob storage
            const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);
            const containerClient = blobServiceClient.getContainerClient('uploads');
            const readyBlobPath = `${request.app_name}/${request.version}/_ready.json`;
            const blockBlobClient = containerClient.getBlockBlobClient(readyBlobPath);

            const readyConfig = {
                requestId: request.id,
                appName: request.app_name,
                version: request.version,
                blobPaths: typeof request.blob_paths === 'string' ? JSON.parse(request.blob_paths) : request.blob_paths
            };

            await blockBlobClient.uploadData(Buffer.from(JSON.stringify(readyConfig)));

            // Enqueue job for Windows Worker
            const queueClient = new QueueClient(process.env.AZURE_STORAGE_CONNECTION_STRING, 'package-jobs');
            await queueClient.createIfNotExists();

            const messageText = JSON.stringify({ requestId: request.id, readyBlobPath });
            await queueClient.sendMessage(Buffer.from(messageText).toString('base64'));

            // Automatically start the Worker VM if it is deallocated
            await startVmInstance();
        }

        res.json({ message: `Request ${newStatus}` });
    } catch (error) {
        console.error('Approval Error:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

module.exports = { handleApproval };
