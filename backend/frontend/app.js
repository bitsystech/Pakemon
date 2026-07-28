document.addEventListener('DOMContentLoaded', async () => {
    enforceAuthentication();

    const user = getCurrentUser();
    if (user) {
        document.getElementById('user-info').innerText = `Logged in as: ${user.name} (${user.username})`;
    }

    loadRequests();
    await loadApps();

    // Main Pill View Switcher (Dashboard / Create Manifest / Logs)
    const mainTabBtns = document.querySelectorAll('.main-tab-btn');
    const viewPanels = document.querySelectorAll('.view-panel');

    mainTabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            mainTabBtns.forEach(b => b.classList.remove('active'));
            viewPanels.forEach(vp => vp.classList.remove('active'));

            btn.classList.add('active');
            const targetView = btn.getAttribute('data-view');
            const targetEl = document.getElementById(targetView);
            if (targetEl) targetEl.classList.add('active');
        });
    });

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
    appNameSelect.addEventListener('change', async (e) => {
        const selectedAppId = e.target.value;
        const selectedOption = e.target.options[e.target.selectedIndex];
        document.getElementById('AppInformation_Publisher').value = selectedOption.dataset.publisher || '';

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
                            // Elements of same name are grouped in a NodeList
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
                document.getElementById('upload-msg').textContent = 'Loaded existing configuration details.';
                document.getElementById('upload-msg').style.color = '#107c10';
            } else {
                document.getElementById('upload-msg').textContent = 'No previous configuration found for this app. Starting fresh.';
                document.getElementById('upload-msg').style.color = 'var(--text-muted)';
            }
        } catch (error) {
            console.warn('Failed to fetch config', error);
        }
    });

    const uploadForm = document.getElementById('upload-form');

    // Setup dynamic Registry Configuration
    const addRegistryBtn = document.getElementById('addRegistryBtn');
    const registryContainer = document.getElementById('registry-container');
    let registryIndex = 0;

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
            <button type="button" class="remove-reg-btn" style="background-color: #a4262c; padding: 0.5rem;">X</button>
        `;

        row.querySelector('.remove-reg-btn').addEventListener('click', () => {
            row.remove();
        });

        registryContainer.appendChild(row);
        registryIndex++;
    });

    uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const msgDiv = document.getElementById('upload-msg');

        // Check required fields manually
        const appName = document.getElementById('AppInformation_ApplicationName').value;
        const version = document.getElementById('AppInformation_Version').value;
        const installerFiles = document.getElementById('installer').files;

        if (!appName || appName === "") {
            msgDiv.textContent = 'Error: Please select an Application Name in the App Information tab.';
            msgDiv.style.color = '#a4262c';
            return;
        }
        if (!version || version.trim() === "") {
            msgDiv.textContent = 'Error: Please provide a Version in the App Information tab.';
            msgDiv.style.color = '#a4262c';
            return;
        }
        if (installerFiles.length === 0) {
            msgDiv.textContent = 'Error: Please upload a Main Installer File.';
            msgDiv.style.color = '#a4262c';
            return;
        }

        msgDiv.textContent = 'Uploading... Please wait.';
        msgDiv.style.color = 'var(--text)';

        const formData = new FormData(uploadForm);

        // Convert all form inputs into a JSON config object
        const configPayload = {};
        const registryChanges = [];

        for (let [key, value] of formData.entries()) {
            if (key !== 'installer' && key !== 'Scripts_PreScriptFile' && key !== 'Scripts_PostScriptFile') {
                // Prevent standard registry fields from attaching to root payload
                if (!key.startsWith('regKey_') && !key.startsWith('regValueName_') && !key.startsWith('regType_') && !key.startsWith('regData_')) {
                    configPayload[key] = value;
                }
            }
        }

        // Extract Registry arrays
        for (let i = 0; i < registryIndex; i++) {
            if (formData.has(`regKey_${i}`)) {
                registryChanges.push({
                    key: formData.get(`regKey_${i}`),
                    valueName: formData.get(`regValueName_${i}`),
                    type: formData.get(`regType_${i}`),
                    data: formData.get(`regData_${i}`)
                });
            }
        }

        if (registryChanges.length > 0) {
            configPayload.registryChanges = registryChanges;
        }

        // Automatically capture all checkbox states into configPayload
        Array.from(uploadForm.querySelectorAll('input[type="checkbox"]')).forEach(cb => {
            if (cb.name) {
                configPayload[cb.name] = cb.checked;
            }
        });

        // The actual API multipart payload
        const submitData = new FormData();
        submitData.append('appName', configPayload.AppInformation_ApplicationName);
        submitData.append('version', configPayload.AppInformation_Version);
        submitData.append('config', JSON.stringify(configPayload));
        submitData.append('installer', document.getElementById('installer').files[0]);

        const progressContainer = document.getElementById('progress-container');
        const progressBar = document.getElementById('upload-progress');
        progressContainer.style.display = 'block';
        progressBar.style.width = '0%';

        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/upload', true);

        const token = await getAuthToken();
        if (token) {
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        }

        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                const percent = Math.round((event.loaded / event.total) * 100);
                progressBar.style.width = percent + '%';
                msgDiv.textContent = `Uploading... ${percent}%`;
            }
        };

        xhr.onload = () => {
            // Added small delay to show 100% completion before hiding
            setTimeout(() => { progressContainer.style.display = 'none'; }, 1000);

            if (xhr.status === 200) {
                try {
                    const responseJson = JSON.parse(xhr.responseText);
                    const uploadedRequestId = responseJson.requestId;
                    msgDiv.textContent = 'Upload received! Finalizing package on server...';
                    msgDiv.style.color = '#0078d4';
                    uploadForm.reset();

                    // Poll the server until the request status changes from 'Uploading' to 'Pending'
                    const pollInterval = setInterval(async () => {
                        const checkResponse = await secureFetch('/api/requests');
                        const allRequests = await checkResponse.json();
                        const myRequest = allRequests.find(r => r.id === uploadedRequestId);

                        if (myRequest && myRequest.status === 'Pending') {
                            clearInterval(pollInterval);
                            msgDiv.textContent = 'Upload successful! Pending approval.';
                            msgDiv.style.color = 'green';
                            loadRequests();

                            // Scroll down smoothly so the user immediately sees the freshly updated requests table
                            const tableContainer = document.getElementById('requests-table');
                            if (tableContainer) {
                                tableContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }
                        } else if (myRequest && myRequest.status === 'Failed') {
                            clearInterval(pollInterval);
                            msgDiv.textContent = 'Upload failed during background processing.';
                            msgDiv.style.color = 'red';
                            loadRequests();
                        }
                    }, 1000);

                } catch (e) {
                    msgDiv.textContent = 'Error parsing server response.';
                    msgDiv.style.color = 'red';
                }

            } else {
                try {
                    const result = JSON.parse(xhr.responseText);
                    msgDiv.textContent = 'Error: ' + result.error;
                } catch (e) {
                    msgDiv.textContent = 'Error: Internal Server Error';
                }
                msgDiv.style.color = 'red';
            }
        };

        xhr.onerror = () => {
            progressContainer.style.display = 'none';
            msgDiv.textContent = 'Network error during upload.';
            msgDiv.style.color = 'red';
        };

        xhr.send(submitData);
    });

    async function loadApps() {
        try {
            const response = await secureFetch('/api/apps');
            const apps = await response.json();
            const select = document.getElementById('AppInformation_ApplicationName');
            select.innerHTML = '<option value="" disabled selected>Select application...</option>';
            apps.forEach(app => {
                const opt = document.createElement('option');
                opt.value = app.id;
                opt.textContent = app.name;
                opt.dataset.publisher = app.publisher;
                select.appendChild(opt);
            });
        } catch (err) {
            console.error('Failed to load apps list', err);
        }
    }

    async function loadRequests() {
        try {
            const response = await secureFetch('/api/requests');
            const requests = await response.json();
            const tbody = document.querySelector('#requests-table tbody');
            tbody.innerHTML = '';

            requests.forEach(req => {
                const tr = document.createElement('tr');

                let statusClass = 'status-pending';
                if (req.status === 'Approved') statusClass = 'status-approved';
                if (req.status === 'Rejected') statusClass = 'status-rejected';
                if (req.status === 'Packaged') statusClass = 'status-approved'; // Reuse green style

                let actions = '';
                const logBtn = `<button onclick="viewLogs(${req.id})" style="background-color: #0078d4; padding: 4px 8px; font-size: 0.8rem; margin-left: 5px;">View Logs</button>`;

                if (req.status === 'Pending') {
                    actions = `
          <button onclick="approveRequest(${req.id})" style="background-color: #107c10; padding: 4px 8px; font-size: 0.8rem;">Approve</button>
          <button onclick="rejectRequest(${req.id})" style="background-color: #a4262c; padding: 4px 8px; font-size: 0.8rem; margin-left: 5px;">Reject</button>
          ${logBtn}
        `;
                } else {
                    actions = `
          <span style="color: var(--text-muted); font-size: 0.85rem; margin-right: 8px;">Processed by ${req.approver || 'System'}</span>
          ${logBtn}
        `;
                }

                tr.innerHTML = `
        <td>${req.id}</td>
        <td>${req.app_name}</td>
        <td>${req.version}</td>
        <td><span class="status-badge ${statusClass}">${req.status}</span></td>
        <td>${req.submitter}</td>
        <td>${new Date(req.created_at).toLocaleString()}</td>
        <td>${actions}</td>
      `;
                tbody.appendChild(tr);
            });
        } catch (err) {
            console.error('Error loading requests', err);
        }
    }

    async function handleAction(requestId, action) {
        try {
            const response = await secureFetch(`/api/requests/${requestId}/approve`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ action })
            });

            if (response.ok) {
                alert(`Request ${requestId} was successfully ${action.toLowerCase()}d!`);
                loadRequests();
            } else {
                const data = await response.json();
                alert(`Error: ${data.error}`);
            }
        } catch (err) {
            alert('Network error while processing request.');
        }
    }

    window.approveRequest = (id) => handleAction(id, 'Approve');
    window.rejectRequest = (id) => handleAction(id, 'Reject');

    let activeLogRequestId = null;

    async function fetchAndDisplayLogs(requestId) {
        const content = document.getElementById('log-content');
        const container = document.getElementById('log-content-container');
        try {
            const response = await secureFetch(`/api/requests/${requestId}/logs?_t=${Date.now()}`);
            if (response.ok) {
                const text = await response.text();
                content.textContent = text || 'Log file is empty.';
                if (container) {
                    setTimeout(() => { container.scrollTop = container.scrollHeight; }, 50);
                }
            } else {
                const errData = await response.json();
                content.textContent = errData.error || 'Failed to load logs.';
            }
        } catch (err) {
            content.textContent = 'Network error while fetching logs.';
        }
    }

    // Log Viewing Logic
    window.viewLogs = async (requestId) => {
        activeLogRequestId = requestId;
        const modal = document.getElementById('log-modal');
        const content = document.getElementById('log-content');
        const reqIdSpan = document.getElementById('log-modal-req-id');

        reqIdSpan.textContent = `#${requestId}`;
        content.textContent = 'Fetching logs from Azure Blob Storage...';
        modal.style.display = 'block';

        await fetchAndDisplayLogs(requestId);
    };

    // Refresh Logs Button Handler
    const refreshLogBtn = document.getElementById('refresh-log-btn');
    if (refreshLogBtn) {
        refreshLogBtn.addEventListener('click', async () => {
            if (activeLogRequestId) {
                const content = document.getElementById('log-content');
                content.textContent = 'Refreshing logs...';
                await fetchAndDisplayLogs(activeLogRequestId);
            }
        });
    }

    // Close Log Modal
    const closeLogModalBtn = document.getElementById('close-log-modal');
    if (closeLogModalBtn) {
        closeLogModalBtn.addEventListener('click', () => {
            document.getElementById('log-modal').style.display = 'none';
        });
    }

    // Close modal if clicking outside the modal content
    window.addEventListener('click', (event) => {
        const modal = document.getElementById('log-modal');
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    });

    // Worker VM Management Logic
    async function updateVmStatus() {
        const dot = document.getElementById('vm-status-dot');
        const text = document.getElementById('vm-status-text');
        const btn = document.getElementById('vm-toggle-btn');
        if (!dot || !text || !btn) return;

        try {
            const response = await secureFetch('/api/worker-vm/status');
            if (response.ok) {
                const data = await response.json();
                const status = data.status || 'VM Unknown';

                if (status.includes('running')) {
                    dot.style.backgroundColor = '#28a745';
                    text.textContent = 'Worker VM: Online';
                    btn.textContent = '⏹️ Stop Worker';
                    btn.style.color = '#dc3545';
                    btn.disabled = false;
                } else if (status.includes('starting')) {
                    dot.style.backgroundColor = '#ffc107';
                    text.textContent = 'Worker VM: Starting...';
                    btn.textContent = '⏳ Starting...';
                    btn.disabled = true;
                } else if (status.includes('deallocated') || status.includes('stopped')) {
                    dot.style.backgroundColor = '#6c757d';
                    text.textContent = 'Worker VM: Off (Saved)';
                    btn.textContent = '▶️ Start Worker';
                    btn.style.color = '#0078d4';
                    btn.disabled = false;
                } else {
                    dot.style.backgroundColor = '#ffc107';
                    text.textContent = `Worker VM: ${status}`;
                    btn.disabled = false;
                }
            }
        } catch (err) {
            console.error('Failed to fetch VM status:', err);
        }
    }

    const vmToggleBtn = document.getElementById('vm-toggle-btn');
    if (vmToggleBtn) {
        vmToggleBtn.addEventListener('click', async () => {
            const currentText = vmToggleBtn.textContent;
            vmToggleBtn.disabled = true;
            
            if (currentText.includes('Start')) {
                vmToggleBtn.textContent = '⏳ Starting...';
                await secureFetch('/api/worker-vm/start', { method: 'POST' });
            } else {
                vmToggleBtn.textContent = '⏳ Stopping...';
                await secureFetch('/api/worker-vm/stop', { method: 'POST' });
            }
            setTimeout(updateVmStatus, 2000);
        });
    }

    updateVmStatus();
    setInterval(updateVmStatus, 15000);
});

// External App Repository Sync (Winget/Evergreen)
async function syncExternalApps() {
    const syncBtn = document.getElementById('sync-apps-btn');
    if (syncBtn) {
        syncBtn.disabled = true;
        syncBtn.textContent = '🔄 Syncing...';
    }

    try {
        const response = await fetch('/api/sync-apps', { method: 'POST' });
        const data = await response.json();
        if (data.success) {
            alert(`✅ ${data.message}`);
            if (typeof fetchRequests === 'function') {
                fetchRequests();
            } else {
                window.location.reload();
            }
        } else {
            alert(`❌ Sync failed: ${data.error || 'Unknown error'}`);
        }
    } catch (err) {
        alert(`❌ Network error while syncing external applications.`);
    } finally {
        if (syncBtn) {
            syncBtn.disabled = false;
            syncBtn.textContent = '⚡ Sync External Apps';
        }
    }
}

// Top-Level Main Navigation View Switcher
function switchMainView(viewId) {
    const views = document.querySelectorAll('.main-view');
    views.forEach(v => v.style.display = 'none');

    const targetView = document.getElementById(viewId);
    if (targetView) {
        targetView.style.display = 'block';
    }

    const navBtns = document.querySelectorAll('.top-nav-btn');
    navBtns.forEach(btn => {
        btn.style.background = 'var(--surface)';
        btn.style.color = 'var(--text)';
        btn.style.border = '1px solid var(--border)';
    });

    const activeBtn = viewId === 'view-builder' ? document.getElementById('nav-btn-builder') : document.getElementById('nav-btn-requests');
    if (activeBtn) {
        activeBtn.style.background = '#0078d4';
        activeBtn.style.color = 'white';
        activeBtn.style.border = 'none';
    }
}
