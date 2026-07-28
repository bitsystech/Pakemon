const axios = require('axios');

async function sendTeamsNotification(message) {
    const webhookUrl = process.env.TEAMS_WEBHOOK_URL;
    if (!webhookUrl) {
        console.log('Teams Webhook not configured. Skipping notification:', message);
        return;
    }

    try {
        await axios.post(webhookUrl, { text: message });
    } catch (error) {
        console.error('Failed to send Teams notification', error);
    }
}

module.exports = { sendTeamsNotification };
