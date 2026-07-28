const { QueueClient } = require('@azure/storage-queue');
require('dotenv').config();

async function run() {
    try {
        const queueClient = new QueueClient(process.env.AZURE_STORAGE_CONNECTION_STRING, 'package-jobs');

        while (true) {
            let response = await queueClient.receiveMessages({ maxMessages: 10 });
            if (response.receivedMessageItems.length === 0) break;

            for (const msg of response.receivedMessageItems) {
                const body = JSON.parse(Buffer.from(msg.messageText, 'base64').toString('utf-8'));
                // Delete if it's the broken ones (requestId < 9)
                if (body.requestId === 5 || body.requestId === 4 || body.requestId === 8) {
                    console.log(`Deleting stuck message for Request ID: ${body.requestId}`);
                    await queueClient.deleteMessage(msg.messageId, msg.popReceipt);
                }
            }
        }
        console.log("Queue purged of stuck messages.");
    } catch (e) {
        console.error(e);
    }
}

run();
