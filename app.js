if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
        .then(reg => console.log('Service Worker registered', reg))
        .catch(err => console.error('Service Worker registration failed', err));
}

const app = (() => {
    // Configuration
    const PB_URL = 'http://localhost:8090';
    const COLLECTION = 'tasks'; // Assuming the collection name in PocketBase is 'tasks'

    // Local Storage Keys
    const STORE_KEY = 'pb_tasks_cache';

    // Helper to get cached tasks
    function getCachedTasks() {
        const stored = localStorage.getItem(STORE_KEY);
        return stored ? JSON.parse(stored) : [];
    }

    // Helper to set cached tasks
    function setCachedTasks(tasks) {
        localStorage.setItem(STORE_KEY, JSON.stringify(tasks));
    }

    // Initialize: Fetch all tasks from backend and update cache
    async function init() {
        try {
            const response = await fetch(`${PB_URL}/api/collections/${COLLECTION}/records?perPage=500`);
            if (!response.ok) throw new Error('Failed to fetch tasks');
            
            const data = await response.json();
            // PocketBase returns items in data.items.
            // We store the raw records (id, task field, etc)
            setCachedTasks(data.items);
            console.log('Tasks synchronized with backend');
        } catch (error) {
            console.error('Offline or backend error:', error);
            // Fallback to existing cache if offline
        }
    }

    // Helper to flatten PB record into a usable task object
    function flattenTask(record) {
        if (!record) return null;
        
        let attachments = [];
        if (record.attachments && Array.isArray(record.attachments)) {
            attachments = record.attachments.map(filename => ({
                type: 'Document',
                name: filename,
                url: `${PB_URL}/api/files/${COLLECTION}/${record.id}/${filename}`
            }));
        }

        return {
            id: record.id,
            content: record.content || "",
            attachment: attachments,
            _pb_attachments: record.attachments || []
        };
    }

    function getTasks() {
        const records = getCachedTasks();
        return records.map(flattenTask);
    }

    function getTask(id) {
        const records = getCachedTasks();
        const record = records.find(r => r.id === id);
        return flattenTask(record);
    }

    async function createTask(taskData, fileToUpload = null) {
        const formData = new FormData();
        
        formData.append('content', taskData.content);

        if (fileToUpload) {
            formData.append('attachments', fileToUpload);
        }

        const response = await fetch(`${PB_URL}/api/collections/${COLLECTION}/records`, {
            method: 'POST',
            // No Content-Type header; browser sets it to multipart/form-data with boundary
            body: formData
        });

        if (!response.ok) {
            const errData = await response.json();
            console.error('PocketBase error:', errData);
            throw new Error('Failed to create task: ' + JSON.stringify(errData));
        }
        
        const createdRecord = await response.json();
        
        // Update local cache manually to avoid full re-fetch
        const tasks = getCachedTasks();
        tasks.push(createdRecord);
        setCachedTasks(tasks);
        
        return flattenTask(createdRecord);
    }

    async function updateTask(taskData, fileToUpload = null, filesToDelete = []) {
        const { id, content } = taskData;
        
        const formData = new FormData();
        formData.append('content', content);

        if (fileToUpload) {
            formData.append('attachments', fileToUpload);
        }
        
        if (filesToDelete && filesToDelete.length > 0) {
            filesToDelete.forEach(filename => {
                // PocketBase convention for deleting individual files in multipart/form-data
                formData.append('attachments-', filename);
            });
        }

        const response = await fetch(`${PB_URL}/api/collections/${COLLECTION}/records/${id}`, {
            method: 'PATCH',
            body: formData
        });

        if (!response.ok) {
            const errData = await response.json();
            console.error('PocketBase error:', errData);
            throw new Error('Failed to update task: ' + JSON.stringify(errData));
        }
        
        const updatedRecord = await response.json();
        
        // Update local cache
        const tasks = getCachedTasks();
        const index = tasks.findIndex(t => t.id === updatedRecord.id);
        if (index !== -1) {
            tasks[index] = updatedRecord;
            setCachedTasks(tasks);
        }
        
        return flattenTask(updatedRecord);
    }

    async function deleteTask(id) {
        const response = await fetch(`${PB_URL}/api/collections/${COLLECTION}/records/${id}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error('Failed to delete task');

        // Update local cache
        const tasks = getCachedTasks();
        const filtered = tasks.filter(t => t.id !== id);
        setCachedTasks(filtered);
        
        return true;
    }

    return {
        init,
        getTasks,
        getTask,
        createTask,
        updateTask,
        deleteTask
    };
})();
