document.addEventListener('DOMContentLoaded', async () => {
    enforceAuthentication();

    // Main Pill View Switcher (Dashboard / Create Manifest / Logs)
    const mainTabBtns = document.querySelectorAll('.main-tab-btn');
    const viewPanels = document.querySelectorAll('.view-panel');

    mainTabBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            mainTabBtns.forEach(b => b.classList.remove('active'));
            viewPanels.forEach(vp => vp.classList.remove('active'));

            btn.classList.add('active');
            const targetView = btn.getAttribute('data-view');
            const targetEl = document.getElementById(targetView);
            if (targetEl) targetEl.classList.add('active');

            if (targetView === 'view-logs' || targetView === 'view-approvals') {
                loadRequests();
            }
        });
    });

    const userInfoEl = document.getElementById('user-info');
    const user = getCurrentUser();
    if (user && userInfoEl) {
        userInfoEl.innerText = `Logged in as: ${user.name} (${user.username})`;
    }

    loadRequests();
    loadApps();

    // Step Tab Navigation inside Create Manifest
    const tabs = document.querySelectorAll('#tab-nav li');
    const contents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            contents.forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            const target = tab.getAttribute('data-tab');
            const targetEl = document.getElementById(target);
            if (targetEl) targetEl.classList.add('active');
        });
    });

    const appNameSelect = document.getElementById('AppInformation_ApplicationName');
    if (appNameSelect) {
        appNameSelect.addEventListener('change', async (e) => {
            const selectedAppId = e.target.value;
            const selectedOption = e.target.options[e.target.selectedIndex];
            const pubInput = document.getElementById('AppInformation_Publisher');
            if (pubInput) pubInput.value = selectedOption.dataset.publisher || '';

            try {
                const response = await secureFetch(`/api/apps/${selectedAppId}/config`);
                if (response.ok) {
                    const config = await response.json();

                    // Form population
                    const uploadForm = document.getElementById('upload-form');
                    for (let key in config) {
                        const el = uploadForm.elements[key];
                        if (el) {
                            if (el.type === 'checkbox') {
                                el.checked = config[key];
                            } else if (el.type === 'radio') {
                                if (el.length > 1) {
                                    Array.from(el).forEach(radio => {
                                        if (radio.value === config[key]) radio.checked = true;
                                    });
                                }
                            } else if (el.type !== 'file') {
                                el.value = config[key];
                            }
                        }
                    }
                    const msg = document.getElementById('upload-msg');
                    if (msg) {
                        msg.textContent = 'Loaded existing configuration details.';
                        msg.style.color = '#107c10';
                    }
                } else {
                    const msg = document.getElementById('upload-msg');
                    if (msg) {
                        msg.textContent = 'No previous configuration found for this app. Starting fresh.';
                        msg.style.color = 'var(--text-muted)';
                    }
                }
            } catch (error) {
                console.warn('Failed to fetch config', error);
            }
        });
    }

    const uploadForm = document.getElementById('upload-form');

    // Setup dynamic Registry Configuration
    const addRegistryBtn = document.getElementById('addRegistryBtn');
    const registryContainer = document.getElementById('registry-container');
    let registryIndex = 0;

    if (addRegistryBtn && registryContainer) {
        addRegistryBtn.addEventListener('click', () => {
            const row = document.createElement('div');
            row.className = 'registry-row';
            row.style.display = 'flex';
            row.style.gap = '10px';
            row.style.marginBottom = '10px';
            row.innerHTML = `
                <input type="text" name="regKey_${registryIndex}" placeholder="HKLM\\Software\\Vendor\\App" style="flex: 2;" required>
                <input type="text" name="regValueName_${registryIndex}" placeholder="Value Name" style="flex: 1;">
                <select name="regType_${registryIndex}" style="flex: 1;">
                    <option value="String">String</option>
                    <option value="DWord">DWord</option>
                    <option value="QWord">QWord</option>
                </select>
                <input type="text" name="regData_${registryIndex}" placeholder="Data" style="flex: 1;" required>
                <button type="button" class="remove-reg-btn" style="background-color: #a4262c; padding: 0.5rem; color: white; border: none; border-radius: 4px;">X</button>
            `;

            row.querySelector('.remove-reg-btn').addEventListener('click', () => {
                row.remove();
            });

            registryContainer.appendChild(row);
            registryIndex++;
        });
    }

    if (uploadForm) {
        uploadForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const msg = document.getElementById('upload-msg');
            msg.textContent = 'Submitting request...';
            msg.style.color = 'var(--text-muted)';

            const formData = new FormData(uploadForm);
            const data = {};

            // Collect form fields into structured object
            formData.forEach((value, key) => {
                // Ignore file inputs from JSON data if empty
                if (key === 'file' && !value.name) return;
                data[key] = value;
            });

            // Handle checkboxes that are unchecked (they aren't included in FormData)
            const checkboxes = uploadForm.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(cb => {
                if (!cb.checked) {
                    data[cb.name] = false;
                } else {
                    data[cb.name] = true;
                }
            });

            try {
                const response = await secureFetch('/api/requests', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(data)
                });

                if (response.ok) {
                    const result = await response.json();
                    msg.textContent = `Success! Package Request ID ${result.requestId} submitted for administrator approval.`;
                    msg.style.color = '#107c10';
                    loadRequests(); // Refresh requests table
                } else {
                    const err = await response.json();
                    msg.textContent = `Error: ${err.error || 'Failed to submit request.'}`;
                    msg.style.color = '#a4262c';
                }
            } catch (error) {
                console.error('Submission failed', error);
                msg.textContent = 'Submission failed due to a network or authentication error.';
                msg.style.color = '#a4262c';
            }
        });
    }

    // Modal Close Logic
    const closeLogModalBtn = document.getElementById('close-log-modal');
    const logModal = document.getElementById('log-modal');
    if (closeLogModalBtn && logModal) {
        closeLogModalBtn.addEventListener('click', () => {
            logModal.style.display = 'none';
        });
    }

    // Theme Toggle Logic
    const themeToggleBtn = document.getElementById('theme-toggle');
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            const currentTheme = document.documentElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', newTheme);
            themeToggleBtn.textContent = newTheme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode';
        });
    }

    // VM Control Toggle Logic & Polling
    const vmToggleBtn = document.getElementById('vm-toggle-btn');
    if (vmToggleBtn) {
        vmToggleBtn.addEventListener('click', async () => {
            const currentText = vmToggleBtn.textContent;
            try {
                if (currentText.includes('Start')) {
                    vmToggleBtn.textContent = '⏳ Starting...';
                    vmToggleBtn.disabled = true;
                    await secureFetch('/api/worker-vm/start', { method: 'POST' });
                } else {
                    vmToggleBtn.textContent = '⏳ Stopping...';
                    vmToggleBtn.disabled = true;
                    await secureFetch('/api/worker-vm/stop', { method: 'POST' });
                }
            } catch (e) {
                console.error('Failed to toggle VM power state', e);
            } finally {
                setTimeout(updateVmStatus, 2000);
            }
        });
    }

    // External Sync Button Logic
    const syncAppsBtn = document.getElementById('sync-apps-btn');
    if (syncAppsBtn) {
        syncAppsBtn.addEventListener('click', async () => {
            syncAppsBtn.textContent = '⏳ Syncing...';
            syncAppsBtn.disabled = true;
            try {
                const res = await secureFetch('/api/sync-external-apps', { method: 'POST' });
                if (res.ok) {
                    alert('External app version check triggered!');
                    loadRequests();
                } else {
                    alert('Sync failed.');
                }
            } catch (err) {
                console.error('Sync request failed', err);
            } finally {
                syncAppsBtn.textContent = 'Sync Ext Apps';
                syncAppsBtn.disabled = false;
            }
        });
    }

    // Refresh Pending List Button Logic
    const refreshPendingBtn = document.getElementById('refresh-pending-btn');
    if (refreshPendingBtn) {
        refreshPendingBtn.addEventListener('click', () => {
            loadRequests();
        });
    }

    // Refresh Logs List Button Logic
    const refreshLogsBtn = document.getElementById('refresh-logs-btn');
    if (refreshLogsBtn) {
        refreshLogsBtn.addEventListener('click', () => {
            loadRequests();
        });
    }

    // Initial VM status check & recurring 15s poll
    updateVmStatus();
    setInterval(updateVmStatus, 15000);
});

async function loadApps(retryCount = 3) {
    try {
        const response = await secureFetch('/api/apps');
        if (!response.ok) throw new Error('Failed to load apps');
        const apps = await response.json();
        const select = document.getElementById('AppInformation_ApplicationName');
        if (!select) return;
        select.innerHTML = '<option value="">Select application...</option>';
        apps.forEach(app => {
            const opt = document.createElement('option');
            opt.value = app.id;
            opt.textContent = `${app.name} (${app.publisher})`;
            opt.dataset.publisher = app.publisher;
            select.appendChild(opt);
        });
    } catch (err) {
        if (retryCount > 0) {
            setTimeout(() => loadApps(retryCount - 1), 1000);
        }
    }
}

async function loadRequests() {
    try {
        const response = await secureFetch('/api/requests');
        if (!response.ok) return;
        const requests = await response.json();

        // 1. Populate Requests & Execution Logs Table
        const tbodyLogs = document.querySelector('#requests-table tbody');
        const logsEmptyState = document.getElementById('logs-empty-state');
        const requestsTable = document.getElementById('requests-table');

        if (tbodyLogs) {
            tbodyLogs.innerHTML = '';
            if (requests.length === 0) {
                if (logsEmptyState) logsEmptyState.style.display = 'block';
                if (requestsTable) requestsTable.style.display = 'none';
            } else {
                if (logsEmptyState) logsEmptyState.style.display = 'none';
                if (requestsTable) requestsTable.style.display = 'table';

                requests.forEach(req => {
                    const tr = document.createElement('tr');
                    let statusClass = 'status-pending';
                    const s = (req.status || '').toLowerCase();
                    if (s.includes('approved') || s.includes('packaged')) statusClass = 'status-approved';
                    if (s.includes('rejected') || s.includes('failed')) statusClass = 'status-rejected';

                    tr.innerHTML = `
                        <td>#${req.id}</td>
                        <td>${escapeHtml(req.app_name || req.package_id || 'N/A')}</td>
                        <td>${escapeHtml(req.version || '1.0')}</td>
                        <td><span class="status-badge ${statusClass}">${escapeHtml(req.status)}</span></td>
                        <td>${escapeHtml(req.submitter || 'Admin')}</td>
                        <td>${new Date(req.created_at).toLocaleDateString()}</td>
                        <td>
                            <button onclick="viewLogs(${req.id})" class="btn-primary-action" style="padding: 4px 10px; font-size: 0.78rem;">View Logs</button>
                        </td>
                    `;
                    tbodyLogs.appendChild(tr);
                });
            }
        }

        // 2. Populate Pending Approvals Table
        const pendingRequests = requests.filter(r => (r.status || '').toLowerCase() === 'pending');
        const pendingBadge = document.getElementById('pending-count-badge');
        if (pendingBadge) pendingBadge.textContent = pendingRequests.length;

        const tbodyPending = document.querySelector('#pending-table tbody');
        const emptyState = document.getElementById('pending-empty-state');
        const pendingTable = document.getElementById('pending-table');

        if (tbodyPending) {
            tbodyPending.innerHTML = '';
            if (pendingRequests.length === 0) {
                if (emptyState) emptyState.style.display = 'block';
                if (pendingTable) pendingTable.style.display = 'none';
            } else {
                if (emptyState) emptyState.style.display = 'none';
                if (pendingTable) pendingTable.style.display = 'table';

                pendingRequests.forEach(req => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>#${req.id}</td>
                        <td>${escapeHtml(req.app_name || req.package_id || 'N/A')}</td>
                        <td>${escapeHtml(req.version || '1.0')}</td>
                        <td><span class="status-badge status-pending">Pending</span></td>
                        <td>${escapeHtml(req.submitter || 'Admin')}</td>
                        <td>${new Date(req.created_at).toLocaleDateString()}</td>
                        <td>
                            <div style="display: flex; gap: 8px;">
                                <button onclick="handleApproveRequest(${req.id})" class="btn-primary-action" style="padding: 6px 14px; font-size: 0.8rem; background-color: #107c10;">✅ Approve</button>
                                <button onclick="handleRejectRequest(${req.id})" class="btn-primary-action" style="padding: 6px 14px; font-size: 0.8rem; background-color: #a4262c;">❌ Reject</button>
                            </div>
                        </td>
                    `;
                    tbodyPending.appendChild(tr);
                });
            }
        }
    } catch (e) {
        console.error('Failed to load requests table', e);
    }
}

async function handleApproveRequest(requestId) {
    if (!confirm(`Approve Request #${requestId} and start packaging on Azure Worker?`)) return;
    try {
        const res = await secureFetch(`/api/requests/${requestId}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'Approve' })
        });
        if (res.ok) {
            alert(`Request #${requestId} approved! The worker VM will start packaging.`);
            loadRequests();
        } else {
            alert(`Failed to approve Request #${requestId}.`);
        }
    } catch (err) {
        console.error('Approval error:', err);
    }
}

async function handleRejectRequest(requestId) {
    if (!confirm(`Reject Request #${requestId}?`)) return;
    try {
        const res = await secureFetch(`/api/requests/${requestId}/approve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'Reject' })
        });
        if (res.ok) {
            alert(`Request #${requestId} rejected.`);
            loadRequests();
        } else {
            alert(`Failed to reject Request #${requestId}.`);
        }
    } catch (err) {
        console.error('Reject error:', err);
    }
}

async function viewLogs(requestId) {
    const modal = document.getElementById('log-modal');
    const modalReqId = document.getElementById('log-modal-req-id');
    const logContent = document.getElementById('log-content');
    const container = document.getElementById('log-content-container');
    const refreshBtn = document.getElementById('refresh-log-btn');

    modalReqId.textContent = `#${requestId}`;
    logContent.textContent = 'Fetching live worker logs from Azure Storage...';
    modal.style.display = 'block';

    const fetchLogs = async () => {
        try {
            const response = await secureFetch(`/api/requests/${requestId}/logs?_t=${Date.now()}`);
            if (response.ok) {
                const logs = await response.text();
                logContent.textContent = logs || 'No log output recorded yet for this request.';
                if (container) container.scrollTop = container.scrollHeight;
            } else {
                logContent.textContent = `Logs not found or not available yet for Request #${requestId}.`;
            }
        } catch (e) {
            logContent.textContent = 'Error loading log output.';
        }
    };

    if (refreshBtn) {
        refreshBtn.onclick = fetchLogs;
    }

    await fetchLogs();
}

async function updateVmStatus() {
    const dot = document.getElementById('vm-status-dot');
    const btn = document.getElementById('vm-toggle-btn');
    if (!dot || !btn) return;

    try {
        const res = await secureFetch('/api/worker-vm/status');
        if (res.ok) {
            const data = await res.json();
            const status = (data.status || '').toLowerCase();
            if (status.includes('running')) {
                dot.style.backgroundColor = '#107c10'; // Green
                dot.title = 'Worker VM is Online';
                btn.textContent = '⏹️ Stop Worker';
                btn.disabled = false;
            } else if (status.includes('starting')) {
                dot.style.backgroundColor = '#ffd700'; // Yellow
                dot.title = 'Worker VM is Starting';
                btn.textContent = '⏳ Starting...';
                btn.disabled = true;
            } else {
                dot.style.backgroundColor = '#a4262c'; // Red
                dot.title = 'Worker VM is Off';
                btn.textContent = '▶️ Start Worker';
                btn.disabled = false;
            }
        }
    } catch (err) {
        console.warn('Failed to fetch VM status', err);
    }
}

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
