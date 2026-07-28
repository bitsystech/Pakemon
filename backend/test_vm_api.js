require('dotenv').config();
const { exec } = require('child_process');

function getVmStatus() {
    return new Promise((resolve, reject) => {
        exec("az vm get-instance-view --resource-group PACKEMON --name apppkg-dev-vm --query \"instanceView.statuses[?starts_with(code, 'PowerState/')].displayStatus\" -o tsv", (error, stdout, stderr) => {
            if (error) {
                return resolve('VM Unknown');
            }
            resolve(stdout.trim() || 'VM Unknown');
        });
    });
}

async function run() {
    const status = await getVmStatus();
    console.log('VM Status:', status);
}

run();
