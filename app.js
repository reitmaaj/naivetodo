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
        // Merge the inner 'task' JSON with the record's 'id'
        // If 'task' is not an object, handle gracefully
        const inner = (typeof record.task === 'object' && record.task !== null) ? record.task : {};
        
        // Map PB attachments to ActivityStreams attachments if they aren't already
        // This is a simplification; in a real AS2 app we might want strict control, 
        // but here we just want to ensure uploaded files show up as AS2 attachments.
        let asAttachments = inner.attachment || [];
        if (!Array.isArray(asAttachments)) asAttachments = [asAttachments];
        
        if (record.attachments && Array.isArray(record.attachments)) {
            const pbFiles = record.attachments.map(filename => ({
                type: 'Document',
                name: filename,
                url: `${PB_URL}/api/files/${COLLECTION}/${record.id}/${filename}`
            }));
            
            // Merge pbFiles into asAttachments if not already present (deduplication logic skipped for simplicity)
            // or just use PB files as the source of truth for "attachment" property in this view
            asAttachments = [...asAttachments, ...pbFiles];
        }

        return {
            ...inner,
            id: record.id,
            attachment: asAttachments,
            // Store the raw attachments filename(s) from PB so we can build URLs or manage them
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
        
        // Wrap the ActivityStreams object into the 'task' field required by DB
        // We must stringify the JSON for the 'task' field when using FormData
        formData.append('task', JSON.stringify(taskData));

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
        // Extract ID, wrap the rest into 'task' field
        const { id, ...innerTask } = taskData;
        
        const formData = new FormData();
        formData.append('task', JSON.stringify(innerTask));

        if (fileToUpload) {
            formData.append('attachments', fileToUpload);
        }
        
        // PocketBase handles file deletion by passing the filename to the field with a "-" prefix
        // or just updating the list without that file (if it was a multiple file field).
        // Wait, for multiple files field, to remove a specific file we usually need to send 
        // the list of files we want to KEEP, OR standard PB API allows passing existing filenames.
        // Actually, for 'multipart/form-data' updates, PB treats the 'attachments' field as "add to existing" usually,
        // unless we strictly set the list.
        // BUT, a robust way to delete specific files in PB via API is problematic with just a PATCH 
        // if we are also adding.
        // Let's assume standard behavior: new files are added. 
        // To delete, we might need a separate call or specific PB syntax.
        // Since the prompt asks to "remove one attachment at a time", let's handle deletion logic 
        // before the update if needed, or rely on PB's specific logic. 
        // PB documentation says: "To delete a file, set the file field to null or empty string". 
        // But for multiple files, that clears all.
        // PB 0.8+ allows deleting individual files by passing the file name to `attachments-` key (not supported in standard FormData easily without specific SDK logic usually, but let's try strict value setting).
        
        // Strategy: 
        // 1. If we have files to delete, we handle them. PocketBase HTTP API says to delete a file from a 'multiple' field, 
        // you often pass the remaining file filenames or use the Admin UI. 
        // Actually, the simplest way for vanilla JS without SDK to delete a specific file from a relation/file field 
        // is often strictly managing the array of filenames if it allows string updates, OR using a specific endpoint.
        // However, standard PB file upload handles "add".
        
        // Let's use the `attachments+` or `attachments-` convention if PB supports it, or simply
        // acknowledge that "updating" JSON 'task' doesn't touch 'attachments' unless we send 'attachments' field.
        
        // If we want to delete a file, we might have to do it separately or pass `attachments` as an array of strings (the ones to keep) + new file? 
        // No, FormData 'attachments' expects File objects.
        
        // For this specific request, let's implement file ADDITION via the fileToUpload.
        // For DELETION, we will rely on a separate specific operation or just not support PB file deletion 
        // in this step unless we iterate. 
        // BUT the prompt says "add a mechanism to remove one attachment at a time".
        
        // We will pass `filesToDelete` array which contains filenames. 
        // We will append `attachments` with empty string or specific instruction?
        // Actually, PocketBase API allows creating a record with files. 
        // Updating: If we send a file with same field name, it appends for 'multiple'.
        // To delete, we usually send `attachments` field with the filename to remove prefixed with `-`? No.
        
        // Let's implement the `updateTask` to handle the JSON update and File Add.
        // We will add a `deleteAttachment` function to `app.js` which hits the file delete endpoint if exists, 
        // or performs a clean update of the record's file list.
        // Since we don't have the PB SDK, we have to follow REST.
        // REST: PATCH /api/collections/.../records/:id 
        // body: { "attachments-": ["filename1.jpg"] } (This is how some adapters do it, but raw API?)
        // Raw API: "To remove a single file from a multiple file field, you have to pass the file name you want to remove to the field name suffixed with - (minus sign)."
        // e.g. formData.append('attachments-', 'filename.jpg')

        if (filesToDelete && filesToDelete.length > 0) {
            filesToDelete.forEach(filename => {
                // Remove ActivityStreams attachment entry from innerTask if present
                if (innerTask.attachment && Array.isArray(innerTask.attachment)) {
                     innerTask.attachment = innerTask.attachment.filter(a => a.name !== filename);
                }
                // PocketBase convention for deleting individual files in multipart/form-data
                formData.append('attachments-', filename);
            });
            // Update the JSON task description to reflect removal
            formData.set('task', JSON.stringify(innerTask));
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
