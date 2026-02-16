const app = (() => {
    // Configuration
    const PB_URL = 'http://localhost:8090';
    const COLLECTION = 'tasks';
    const CACHE_KEY = 'astodo_tasks';

    function getCachedTasks() {
        const stored = localStorage.getItem(CACHE_KEY);
        return stored ? JSON.parse(stored) : [];
    }

    function setCachedTasks(tasks) {
        localStorage.setItem(CACHE_KEY, JSON.stringify(tasks));
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
            attachment: attachments,
            created: record.created,
            updated: record.updated,
            edited: record.edited,
            deadline: record.deadline,
            delayed: record.delayed
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

    async function createTask(content, deadline, files = []) {
        const formData = new FormData();
        formData.append('content', content);
        if (deadline) {
            formData.append('deadline', deadline);
        }
        
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
        
        const record = await response.json();
        // Update local cache
        const tasks = getCachedTasks();
        tasks.push(record);
        setCachedTasks(tasks);

        return flattenTask(record);
    }

    async function patchTask(id, data) {
        const response = await fetch(`${PB_URL}/api/collections/${COLLECTION}/records/${id}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const errData = await response.json();
            console.error('PocketBase error:', errData);
            throw new Error('Failed to patch task');
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

    async function updateTask(id, content, deadline, filesToAdd = [], filesToDelete = []) {
        const formData = new FormData();
        formData.append('content', content);
        formData.append('edited', new Date().toISOString());
        if (deadline) {
            formData.append('deadline', deadline);
        } else {
            formData.append('deadline', '');
        }

        filesToAdd.forEach(file => {
            formData.append('attachments+', file);
        });

        filesToDelete.forEach(filename => {
            formData.append('attachments-', filename);
        });

        const response = await fetch(`${PB_URL}/api/collections/${COLLECTION}/records/${id}`, {
            method: 'PATCH',
            body: formData
        });

        if (!response.ok) {
            const errData = await response.json();
            console.error('PocketBase error:', errData);
            throw new Error('Failed to update task');
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

    function getMostDominantTask() {
        const tasks = getTasks();
        if (tasks.length === 0) return null;

        const metrics = tasks.map(task => {
            const created = new Date(task.created).getTime();
            // If delayed is missing, assume created time (it's been waiting since creation)
            const delayed = task.delayed ? new Date(task.delayed).getTime() : created;
            // If deadline is missing, assume far future
            const deadline = task.deadline ? new Date(task.deadline).getTime() : Number.MAX_SAFE_INTEGER;

            return {
                id: task.id,
                t1: created, // Minimize (older is better)
                t2: delayed, // Minimize (older delay is better)
                t3: deadline // Minimize (closer/overdue is better)
            };
        });

        const dominanceCounts = metrics.map((candidate, i) => {
            let count = 0;
            metrics.forEach((target, j) => {
                if (i === j) return;

                // Candidate dominates Target if:
                // Candidate is better (smaller) or equal in all metrics
                // AND strictly better (smaller) in at least one
                
                const betterInAtLeastOne = 
                    candidate.t1 < target.t1 || 
                    candidate.t2 < target.t2 || 
                    candidate.t3 < target.t3;

                const worseInNone = 
                    candidate.t1 <= target.t1 && 
                    candidate.t2 <= target.t2 && 
                    candidate.t3 <= target.t3;

                if (betterInAtLeastOne && worseInNone) {
                    count++;
                }
            });
            return { index: i, count };
        });

        const maxCount = Math.max(...dominanceCounts.map(d => d.count));
        const winners = dominanceCounts
            .filter(d => d.count === maxCount)
            .map(d => tasks[d.index]);

        return winners[Math.floor(Math.random() * winners.length)];
    }

    return {
        init,
        getTasks,
        getTask,
        createTask,
        updateTask,
        patchTask,
        deleteTask,
        getMostDominantTask
    };
})();
