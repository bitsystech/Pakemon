const { QueueClient } = require('@azure/storage-queue');
require('dotenv').config();

async function peekQueue() {
    try {
        const queueClient = new QueueClient(process.env.AZURE_STORAGE_CONNECTION_STRING, 'package-jobs');

        const peekedMessages = await queueClient.peekMessages({ numberOfMessages: 10 });
        console.log(`Peeked ${peekedMessages.peekedMessageItems.length} messages in 'package-jobs':`);
        for (const msg of peekedMessages.peekedMessageItems) {
            const rawBody = msg.messageText;
            try {
                const decoded = Buffer.from(rawBody, 'base64').toString('utf8');
                console.log(`- ID ${msg.messageId}: ${decoded}`);
            } catch (e) {
                console.log(`- ID ${msg.messageId}: ${rawBody}`);
            }
        }
    } catch (err) {
        console.error("Queue peek error:", err.message);
    }
}

peekQueue();
