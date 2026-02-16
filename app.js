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
            // PocketBase returns items in data.items
            setCachedTasks(data.items);
            console.log('Tasks synchronized with backend');
        } catch (error) {
            console.error('Offline or backend error:', error);
            // Fallback to existing cache if offline
        }
    }

    function getTasks() {
        return getCachedTasks();
    }

    function getTask(id) {
        const tasks = getCachedTasks();
        return tasks.find(t => t.id === id);
    }

    async function createTask(taskData) {
        // ActivityStreams 2.0 structure implies we send specific fields.
        // PocketBase expects a flat JSON structure usually, but we will send
        // what the user requested.
        const response = await fetch(`${PB_URL}/api/collections/${COLLECTION}/records`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(taskData)
        });

        if (!response.ok) {
            const errData = await response.json();
            console.error('PocketBase error:', errData);
            throw new Error('Failed to create task: ' + JSON.stringify(errData));
        }
        
        const createdTask = await response.json();
        
        // Update local cache manually to avoid full re-fetch
        const tasks = getCachedTasks();
        tasks.push(createdTask);
        setCachedTasks(tasks);
        
        return createdTask;
    }

    async function updateTask(taskData) {
        const response = await fetch(`${PB_URL}/api/collections/${COLLECTION}/records/${taskData.id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(taskData)
        });

        if (!response.ok) {
            const errData = await response.json();
            console.error('PocketBase error:', errData);
            throw new Error('Failed to update task: ' + JSON.stringify(errData));
        }
        
        const updatedTask = await response.json();
        
        // Update local cache
        const tasks = getCachedTasks();
        const index = tasks.findIndex(t => t.id === updatedTask.id);
        if (index !== -1) {
            tasks[index] = updatedTask;
            setCachedTasks(tasks);
        }
        
        return updatedTask;
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
