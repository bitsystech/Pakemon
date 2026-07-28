require('dotenv').config();
const { QueueClient } = require("@azure/storage-queue");

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
const queueName = "package-jobs";

async function main() {
    const queueClient = new QueueClient(connectionString, queueName);

    // Using an existing known Blob path from Request 19 to trigger the VM again
    const message = JSON.stringify({
        requestId: 19,
        readyBlobPath: "vlc-media-player/123/_ready.json"
    });

    const encodedMessage = Buffer.from(message).toString('base64');

    console.log(`Sending message back to queue: ${message}`);
    await queueClient.sendMessage(encodedMessage);
    console.log("Success! The Windows VM Worker will pick this up in ~10 seconds.");
}

main().catch(console.error);
