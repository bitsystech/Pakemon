const { exec } = require('child_process');

function delegateTaskToJules(title, prompt) {
    return new Promise((resolve, reject) => {
        const fullBody = `@jules\n\n### Task Requirement:\n${prompt}\n\n---\n*Delegated automatically via Antigravity Pair Programmer.*`;
        
        // Escape quotes for bash command execution
        const escapedTitle = title.replace(/"/g, '\\"');
        const escapedBody = fullBody.replace(/"/g, '\\"');

        const cmd = `gh issue create --repo bitsystech/Pakemon --title "${escapedTitle}" --body "${escapedBody}"`;
        
        console.log(`[JulesDispatcher] Dispatching task to Jules via GitHub Issue...`);
        exec(cmd, (error, stdout, stderr) => {
            if (error) {
                console.error('[JulesDispatcher] Error dispatching to Jules:', stderr);
                return resolve({ success: false, error: stderr });
            }
            const issueUrl = stdout.trim();
            console.log(`[JulesDispatcher] Successfully created issue: ${issueUrl}`);
            resolve({ success: true, issueUrl });
        });
    });
}

// Allow CLI execution
if (require.main === module) {
    const args = process.argv.slice(2);
    const title = args[0] || "Automated Task";
    const prompt = args[1] || "Implement requested feature.";
    delegateTaskToJules(title, prompt).then(res => console.log(res));
}

module.exports = { delegateTaskToJules };
