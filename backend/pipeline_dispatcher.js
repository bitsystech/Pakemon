const { QueueClient } = require('@azure/storage-queue');
const https = require('https');

/**
 * Pipeline Dispatcher Abstraction Layer
 * Supports switching between Azure Storage Queue (Worker VM) and GitHub Actions Workflows seamlessly via PIPELINE_PROVIDER env variable.
 */
async function dispatchJob(payload) {
    const provider = process.env.PIPELINE_PROVIDER || 'azure_queue';

    console.log(`[PipelineDispatcher] Dispatching job #${payload.requestId} using provider: ${provider}`);

    if (provider === 'github_actions') {
        return await dispatchGitHubActions(payload);
    } else {
        return await dispatchAzureQueue(payload);
    }
}

async function dispatchAzureQueue(payload) {
    if (!process.env.AZURE_STORAGE_CONNECTION_STRING) {
        console.log(`[PipelineDispatcher] Azure Storage connection string missing. Skipping queue.`);
        return { success: false, provider: 'azure_queue', reason: 'Missing connection string' };
    }

    const queueClient = new QueueClient(process.env.AZURE_STORAGE_CONNECTION_STRING, 'package-jobs');
    const encodedMsg = Buffer.from(JSON.stringify(payload)).toString('base64');
    await queueClient.sendMessage(encodedMsg);
    console.log(`[PipelineDispatcher] Sent message to Azure Storage Queue for Request #${payload.requestId}`);
    return { success: true, provider: 'azure_queue' };
}

async function dispatchGitHubActions(payload) {
    const repoOwner = process.env.GITHUB_REPO_OWNER;
    const repoName = process.env.GITHUB_REPO_NAME;
    const token = process.env.GITHUB_TOKEN;

    if (!repoOwner || !repoName || !token) {
        console.log(`[PipelineDispatcher] GitHub environment variables missing. Falling back to Azure Queue.`);
        return await dispatchAzureQueue(payload);
    }

    const postData = JSON.stringify({
        event_type: 'package-app',
        client_payload: payload
    });

    const options = {
        hostname: 'api.github.com',
        path: `/repos/${repoOwner}/${repoName}/dispatches`,
        method: 'POST',
        headers: {
            'User-Agent': 'Packemon-Backend',
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    return new Promise((resolve) => {
        const req = https.request(options, (res) => {
            if (res.statusCode === 204 || res.statusCode === 200) {
                console.log(`[PipelineDispatcher] Successfully dispatched GitHub Actions workflow for Request #${payload.requestId}`);
                resolve({ success: true, provider: 'github_actions' });
            } else {
                console.warn(`[PipelineDispatcher] GitHub Actions dispatch failed with status: ${res.statusCode}`);
                resolve({ success: false, provider: 'github_actions', statusCode: res.statusCode });
            }
        });

        req.on('error', (e) => {
            console.error('[PipelineDispatcher] GitHub API Error:', e);
            resolve({ success: false, provider: 'github_actions', error: e.message });
        });

        req.write(postData);
        req.end();
    });
}

module.exports = { dispatchJob };
