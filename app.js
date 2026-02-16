const app = (() => {
    // Configuration
    const PB_URL = 'http://localhost:8090';
    const COLLECTION = 'tasks';

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
        createTask
    };
})();
