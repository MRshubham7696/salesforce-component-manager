// Encryption/Decryption Functions
async function encryptData(data, password) {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(JSON.stringify(data));
    
    // Create a key from password
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        'PBKDF2',
        false,
        ['deriveKey']
    );
    
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt']
    );
    
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        dataBuffer
    );
    
    // Combine salt, iv, and encrypted data
    const result = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    result.set(salt, 0);
    result.set(iv, salt.length);
    result.set(new Uint8Array(encrypted), salt.length + iv.length);
    
    return btoa(String.fromCharCode.apply(null, result));
}

async function decryptData(encryptedData, password) {
    const encoder = new TextEncoder();
    const data = new Uint8Array(atob(encryptedData).split('').map(char => char.charCodeAt(0)));
    
    // Extract salt, iv, and encrypted data
    const salt = data.slice(0, 16);
    const iv = data.slice(16, 28);
    const encrypted = data.slice(28);
    
    // Recreate key from password
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        'PBKDF2',
        false,
        ['deriveKey']
    );
    
    const key = await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
    );
    
    const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        encrypted
    );
    
    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(decrypted));
}

// GitHub Configuration
let githubConfig = {
    username: '',
    repo: 'salesforce-component-manager',
    token: '',
    branch: 'main',
    encryptionPassword: ''
};

// Global variables
let components = [];
let editingComponentId = null;
let fileSha = null;

// DOM Elements
const loadingDiv = document.getElementById('loadingDiv');
const componentsGrid = document.getElementById('componentsGrid');
const emptyState = document.getElementById('emptyState');
const searchInput = document.getElementById('searchInput');
const componentModal = document.getElementById('componentModal');
const setupModal = document.getElementById('setupModal');
const componentForm = document.getElementById('componentForm');
const modalTitle = document.getElementById('modalTitle');
const setupNotice = document.getElementById('setupNotice');

// Configuration Management
function loadConfig() {
    const saved = localStorage.getItem('githubConfig');
    if (saved) {
        githubConfig = JSON.parse(saved);
        if (githubConfig.username && githubConfig.token && githubConfig.encryptionPassword) {
            setupNotice.classList.add('hidden');
            return true;
        }
    }
    return false;
}

function saveConfig() {
    localStorage.setItem('githubConfig', JSON.stringify(githubConfig));
}

// GitHub API functions
async function githubRequest(endpoint, method = 'GET', data = null) {
    const url = `https://api.github.com/repos/${githubConfig.username}/${githubConfig.repo}/${endpoint}`;
    const options = {
        method,
        headers: {
            'Authorization': `token ${githubConfig.token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'User-Agent': 'Salesforce-Component-Manager' 
        }
    };

    if (data) {
        options.body = JSON.stringify(data);
    }

    console.log('Making request...');
    const response = await fetch(url, options);
    
    console.log('Response status:', response.status);
    
    if (!response.ok) {
        const errorText = await response.text();
        console.error('Error response:', errorText);
        
        let error;
        try {
            error = JSON.parse(errorText);
        } catch (e) {
            error = { message: errorText };
        }
        
        throw new Error(error.message || `GitHub API error: ${response.status}`);
    }
    
    const result = await response.json();
    console.log('Success! Response received');
    
    return result;
}

// Component Management with Encryption
async function loadComponents() {
    if (!githubConfig.token || !githubConfig.encryptionPassword) {
        setupNotice.classList.remove('hidden');
        showLoading(false);
        displayComponents([]);
        return;
    }

    try {
        showLoading(true);
        
        try {
            const file = await githubRequest('contents/components.json');
            const encryptedContent = atob(file.content);
            
            // Decrypt the content
            const content = await decryptData(encryptedContent, githubConfig.encryptionPassword);
            components = content.components || [];
            fileSha = file.sha;
        } catch (error) {
            if (error.message.includes('404')) {
                components = [];
                fileSha = null;
            } else if (error.name === 'OperationError' || error.message.includes('decrypt')) {
                throw new Error('Failed to decrypt data. Please check your encryption password.');
            } else {
                throw error;
            }
        }

        displayComponents(components);
        showLoading(false);
    } catch (error) {
        console.error("Error loading components:", error);
        showLoading(false);
        alert(`Error loading components: ${error.message}`);
    }
}

async function saveComponents() {
    try {
        if (!githubConfig.encryptionPassword) {
            throw new Error('Encryption password not set');
        }
        
        const data = {
            components: components,
            lastUpdated: new Date().toISOString(),
            encrypted: true,
            version: '1.0'
        };

        // Encrypt the data
        const encryptedContent = await encryptData(data, githubConfig.encryptionPassword);
        
        const commitData = {
            message: `Update encrypted components data - ${new Date().toLocaleString()}`,
            content: btoa(encryptedContent),
            branch: githubConfig.branch
        };

        if (fileSha) {
            commitData.sha = fileSha;
        }

        const result = await githubRequest('contents/components.json', 'PUT', commitData);
        fileSha = result.content.sha;
        
        return true;
    } catch (error) {
        console.error("Error saving components:", error);
        alert(`Error saving components: ${error.message}`);
        return false;
    }
}

async function addComponent(componentData) {
    const newComponent = {
        id: Date.now().toString(),
        ...componentData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    components.unshift(newComponent);
    
    if (await saveComponents()) {
        displayComponents(components);
        closeModal();
        alert("Component added successfully!");
    } else {
        components.shift();
    }
}

async function updateComponent(componentId, componentData) {
    const index = components.findIndex(c => c.id === componentId);
    if (index === -1) return;

    const originalComponent = { ...components[index] };
    components[index] = {
        ...components[index],
        ...componentData,
        updatedAt: new Date().toISOString()
    };

    if (await saveComponents()) {
        displayComponents(components);
        closeModal();
        alert("Component updated successfully!");
    } else {
        components[index] = originalComponent;
    }
}

// UI Functions
function displayComponents(componentsToShow) {
    if (componentsToShow.length === 0) {
        componentsGrid.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';
    componentsGrid.style.display = 'grid';
    
    componentsGrid.innerHTML = componentsToShow.map(component => `
        <div class="card">
            <div class="card-header">
                <div class="card-title">${component.name}</div>
                <div class="card-type">${component.type}</div>
            </div>
            <div class="card-body">
                <div class="card-description">${component.description || 'No description provided'}</div>
                <div class="card-meta">
                    <span>Version: ${component.version || 'N/A'}</span>
                    <span>Author: ${component.author || 'Unknown'}</span>
                </div>
                <div class="card-meta">
                    <span>Created: ${component.createdAt ? new Date(component.createdAt).toLocaleDateString() : 'N/A'}</span>
                </div>
                <div class="card-actions">
                    <button class="btn btn-primary btn-sm" onclick="editComponent('${component.id}')">Edit</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteComponent('${component.id}')">Delete</button>
                </div>
            </div>
        </div>
    `).join('');
}

function showLoading(show) {
    loadingDiv.style.display = show ? 'block' : 'none';
    if (!show) {
        componentsGrid.style.display = components.length > 0 ? 'grid' : 'none';
    }
}

// Global Functions
window.deleteComponent = async function(componentId) {
    if (!confirm("Are you sure you want to delete this component?")) {
        return;
    }

    const index = components.findIndex(c => c.id === componentId);
    if (index === -1) return;

    const removedComponent = components.splice(index, 1)[0];

    if (await saveComponents()) {
        displayComponents(components);
        alert("Component deleted successfully!");
    } else {
        components.splice(index, 0, removedComponent);
    }
};

window.editComponent = function(componentId) {
    const component = components.find(c => c.id === componentId);
    if (!component) return;

    editingComponentId = componentId;
    modalTitle.textContent = "Edit Component";
    
    document.getElementById('componentName').value = component.name;
    document.getElementById('componentType').value = component.type;
    document.getElementById('componentDescription').value = component.description || '';
    document.getElementById('componentVersion').value = component.version || '';
    document.getElementById('componentAuthor').value = component.author || '';
    
    componentModal.style.display = 'block';
};

window.openAddModal = function() {
    if (!githubConfig.token || !githubConfig.encryptionPassword) {
        openSetupModal();
        return;
    }
    
    editingComponentId = null;
    modalTitle.textContent = "Add New Component";
    componentForm.reset();
    componentModal.style.display = 'block';
};

window.closeModal = function() {
    componentModal.style.display = 'none';
    componentForm.reset();
    editingComponentId = null;
};

// Setup Modal Functions
window.openSetupModal = function() {
    if (githubConfig.username) {
        document.getElementById('githubUsername').value = githubConfig.username;
    }
    if (githubConfig.repo) {
        document.getElementById('githubRepo').value = githubConfig.repo;
    }
    setupModal.style.display = 'block';
};

window.closeSetupModal = function() {
    setupModal.style.display = 'none';
};

window.saveGitHubConfig = function() {
    const username = document.getElementById('githubUsername').value.trim();
    const repo = document.getElementById('githubRepo').value.trim();
    const token = document.getElementById('githubToken').value.trim();
    const encryptionPassword = document.getElementById('encryptionPassword').value.trim();

    if (!username || !repo || !token || !encryptionPassword) {
        alert('Please fill in all fields including the encryption password');
        return;
    }

    if (encryptionPassword.length < 8) {
        alert('Encryption password must be at least 8 characters long');
        return;
    }

    githubConfig.username = username;
    githubConfig.repo = repo;
    githubConfig.token = token;
    githubConfig.encryptionPassword = encryptionPassword;
    
    saveConfig();
    setupNotice.classList.add('hidden');
    closeSetupModal();
    
    // Clear sensitive fields for security
    document.getElementById('githubToken').value = '';
    document.getElementById('encryptionPassword').value = '';
    
    alert('Configuration saved! Your data will now be encrypted before storage.');
    loadComponents();
};

// Event Listeners
function initializeEventListeners() {
    searchInput.addEventListener('input', function() {
        const searchTerm = this.value.toLowerCase();
        const filteredComponents = components.filter(component =>
            component.name.toLowerCase().includes(searchTerm) ||
            component.type.toLowerCase().includes(searchTerm) ||
            (component.description && component.description.toLowerCase().includes(searchTerm))
        );
        displayComponents(filteredComponents);
    });

    componentForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const componentData = {
            name: document.getElementById('componentName').value,
            type: document.getElementById('componentType').value,
            description: document.getElementById('componentDescription').value,
            version: document.getElementById('componentVersion').value,
            author: document.getElementById('componentAuthor').value
        };

        if (editingComponentId) {
            await updateComponent(editingComponentId, componentData);
        } else {
            await addComponent(componentData);
        }
    });

    document.getElementById('addComponentBtn').addEventListener('click', openAddModal);
    document.getElementById('refreshBtn').addEventListener('click', loadComponents);

    window.addEventListener('click', function(event) {
        if (event.target === componentModal) {
            closeModal();
        }
        if (event.target === setupModal) {
            closeSetupModal();
        }
    });
}

// Initialize Application
function initializeApp() {
    initializeEventListeners();
    
    if (loadConfig()) {
        loadComponents();
    } else {
        showLoading(false);
        displayComponents([]);
    }
}

document.addEventListener('DOMContentLoaded', initializeApp);
