const app = (() => {
    // Configuration
    const PB_URL = 'http://localhost:8090';
    const COLLECTION = 'tasks';
    const CACHE_KEY = 'astodo_tasks';

    function getCachedTasks() {
        const stored = localStorage.getItem(CACHE_KEY);
        return stored ? JSON.parse(stored) : [];
    }

    function flattenTask(record) {
        if (!record) return null;
        
        let attachments = [];
        
        // 1. Gather files from the plural 'attachments' field
        if (record.attachments) {
            const list = Array.isArray(record.attachments) 
                ? record.attachments 
                : [record.attachments];
            
            list.forEach(filename => {
                attachments.push({
                    type: 'Document',
                    name: filename,
                    url: `${PB_URL}/api/files/${COLLECTION}/${record.id}/${filename}`
                });
            });
        }

        // 2. Gather files from the singular 'attachment' field
        if (record.attachment) {
            const list = Array.isArray(record.attachment) 
                ? record.attachment 
                : [record.attachment];
                
            list.forEach(filename => {
                if (!attachments.find(a => a.name === filename)) {
                    attachments.push({
                        type: 'Document',
                        name: filename,
                        url: `${PB_URL}/api/files/${COLLECTION}/${record.id}/${filename}`
                    });
                }
            });
        }

        return {
            id: record.id,
            content: record.task || record.content || "",
            attachment: attachments
        };
    }

    async function init() {
        try {
            const response = await fetch(`${PB_URL}/api/collections/${COLLECTION}/records?perPage=500&sort=-created`);
            if (response.ok) {
                const data = await response.json();
                localStorage.setItem(CACHE_KEY, JSON.stringify(data.items));
            }
        } catch (e) {
            console.error("Init failed", e);
        }
    }

    function getTasks() {
        return getCachedTasks().map(flattenTask);
    }

    function getTask(id) {
        const tasks = getCachedTasks();
        const record = tasks.find(t => t.id === id);
        return flattenTask(record);
    }

    async function createTask(content, files = []) {
        const formData = new FormData();
        formData.append('content', content);
        
        files.forEach(file => {
            formData.append('attachments', file);
        });

        const response = await fetch(`${PB_URL}/api/collections/${COLLECTION}/records`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errData = await response.json();
            console.error('PocketBase error:', errData);
            throw new Error('Failed to create task');
        }
        
        return await response.json();
    }

    return {
        init,
        getTasks,
        getTask,
        createTask
    };
})();
