// This script will run in the webview
(function() {
    const vscode = acquireVsCodeApi();
    console.log('PromptBuddy webview initialized');

    // State management
    let documentState = {
        segments: [],
        version: 0
    };

    const contentContainer = document.querySelector('.content');
    if (!contentContainer) {
        console.error('Could not find content container');
    }

    // Define addFileToContext before it's used
    function addFileToContext(path) {
        // Get current content
        const content = documentState.segments.find(s => s.type === 'section' && s.tag === 'pb-context')?.content || '';
        
        // Split content into lines and filter empty ones
        const items = content.split('\n').filter(line => line.trim());
        
        // Add new item if it doesn't exist
        if (!items.includes(path)) {
            items.push(path);
        }

        // Create new content by joining with newlines
        const newContent = items.join('\n');
        
        // Update state and notify extension
        documentState.segments = documentState.segments.map(segment => {
            if (segment.type === 'section' && segment.tag === 'pb-context') {
                return { ...segment, content: newContent };
            }
            return segment;
        });
        documentState.version++;

        vscode.postMessage({
            type: 'updateSection',
            tag: 'pb-context',
            content: newContent,
            version: documentState.version
        });

        // Force a re-render
        render();
    }

    // Handle messages from the extension
    window.addEventListener('message', event => {
        const message = event.data;
        console.log('Received message:', message);
        
        switch (message.type) {
            case 'update':
                // Only handle updates from the extension if they're newer than our local edits
                if (message.version > documentState.version) {
                    documentState = {
                        segments: parseDocument(message.text),
                        version: message.version
                    };
                    render();
                }
                break;
            case 'fileSelected':
                if (message.paths && message.paths.length > 0) {
                    // Get current content
                    const content = documentState.segments.find(s => s.type === 'section' && s.tag === 'pb-context')?.content || '';
                    const items = content.split('\n').filter(line => line.trim());
                    
                    // Add all new paths that don't exist yet
                    message.paths.forEach(path => {
                        if (!items.includes(path)) {
                            items.push(path);
                        }
                    });

                    // Create new content by joining with newlines
                    const newContent = items.join('\n');
                    
                    // Update state and notify extension
                    documentState.segments = documentState.segments.map(segment => {
                        if (segment.type === 'section' && segment.tag === 'pb-context') {
                            return { ...segment, content: newContent };
                        }
                        return segment;
                    });
                    documentState.version++;

                    vscode.postMessage({
                        type: 'updateSection',
                        tag: 'pb-context',
                        content: newContent,
                        version: documentState.version
                    });

                    // Force a re-render
                    render();
                }
                break;
            case 'copyProcessed':
                navigator.clipboard.writeText(message.text).then(() => {
                    const copyButton = document.querySelector('.copy-button');
                    if (copyButton) {
                        copyButton.innerHTML = '✓ Copied!';
                        copyButton.classList.add('success');
                        
                        setTimeout(() => {
                            copyButton.innerHTML = '📋 Copy as Prompt to Clipboard';
                            copyButton.classList.remove('success');
                        }, 2000);
                    }
                }).catch(err => {
                    console.error('Failed to copy:', err);
                    const copyButton = document.querySelector('.copy-button');
                    if (copyButton) {
                        copyButton.innerHTML = '❌ Failed to copy';
                        copyButton.classList.add('error');
                        
                        setTimeout(() => {
                            copyButton.innerHTML = '📋 Copy as Prompt to Clipboard';
                            copyButton.classList.remove('error');
                        }, 2000);
                    }
                });
                break;
        }
    });

    // Parse the document into segments (text and XML sections)
    function parseDocument(text) {
        const segments = [];
        let currentIndex = 0;
        
        const tagRegex = /<(pb-context|pb-note)>([\s\S]*?)<\/\1>/g;
        let match;

        while ((match = tagRegex.exec(text)) !== null) {
            // Add text before the tag if there is any
            if (match.index > currentIndex) {
                segments.push({
                    type: 'text',
                    content: text.substring(currentIndex, match.index)
                });
            }

            // Add the tagged section, trim any whitespace around the content
            // but preserve internal newlines
            segments.push({
                type: 'section',
                tag: match[1],
                content: match[2].trim()
            });

            currentIndex = match.index + match[0].length;
        }

        // Add any remaining text
        if (currentIndex < text.length) {
            segments.push({
                type: 'text',
                content: text.substring(currentIndex)
            });
        }

        return segments;
    }

    // Render the current state to the DOM
    function render() {
        // Clear existing content
        contentContainer.innerHTML = '';
        
        // Add copy button at the top
        const copyButton = document.createElement('button');
        copyButton.className = 'copy-button';
        copyButton.innerHTML = '📋 Copy as Prompt to Clipboard';
        copyButton.title = 'Copy as Prompt to Clipboard';
        copyButton.addEventListener('click', async () => {
            vscode.postMessage({
                type: 'prepareForCopy'
            });
        });
        
        contentContainer.appendChild(copyButton);
        
        // Render each segment
        documentState.segments.forEach(segment => {
            if (segment.type === 'text') {
                const div = document.createElement('div');
                div.className = 'markdown-content';
                div.textContent = segment.content;
                contentContainer.appendChild(div);
            } else {
                const section = createEditableSection(segment.tag, segment.content);
                contentContainer.appendChild(section);
            }
        });
    }

    // Create an editable section for XML tags
    function createEditableSection(tag, content) {
        const container = document.createElement('div');
        container.className = 'editable-section';

        const label = document.createElement('div');
        label.className = 'section-label';
        label.textContent = tag;
        container.appendChild(label);

        if (tag === 'pb-context') {
            // Create context section with file search and items list
            const searchContainer = document.createElement('div');
            searchContainer.className = 'context-search';

            // Add button for quick pick
            const addButton = document.createElement('button');
            addButton.className = 'add-file-button';
            addButton.textContent = 'Browse Files...';
            addButton.title = 'Search workspace files';
            
            // Handle quick pick button
            addButton.addEventListener('click', () => {
                // Get current files from context
                const currentFiles = content.split('\n').filter(line => line.trim());
                vscode.postMessage({
                    type: 'showFilePicker',
                    currentFiles: currentFiles
                });
            });

            searchContainer.appendChild(addButton);
            container.appendChild(searchContainer);

            // Display existing items
            const itemsContainer = document.createElement('div');
            itemsContainer.className = 'context-items';
            
            // Parse lines into items
            const items = content.split('\n').filter(line => line.trim());
            
            console.log('Found items:', items.length); // Debug log

            items.forEach(path => {
                console.log('Creating item for:', path); // Debug log
                const itemDiv = document.createElement('div');
                itemDiv.className = 'context-item';

                // Create icon element
                const iconSpan = document.createElement('span');
                iconSpan.className = 'file-icon';
                iconSpan.innerHTML = '📄';
                itemDiv.appendChild(iconSpan);

                // Text content
                const textSpan = document.createElement('span');
                textSpan.className = 'item-text';
                textSpan.textContent = path;
                itemDiv.appendChild(textSpan);

                // Remove button
                const removeButton = document.createElement('button');
                removeButton.className = 'remove-item';
                removeButton.innerHTML = '✕';
                removeButton.title = 'Remove file';
                removeButton.addEventListener('click', () => {
                    const currentItems = content.split('\n')
                        .filter(line => line.trim())
                        .filter(item => item !== path);

                    const newContent = currentItems.join('\n');
                    
                    documentState.segments = documentState.segments.map(segment => {
                        if (segment.type === 'section' && segment.tag === 'pb-context') {
                            return { ...segment, content: newContent };
                        }
                        return segment;
                    });
                    documentState.version++;

                    vscode.postMessage({
                        type: 'updateSection',
                        tag: 'pb-context',
                        content: newContent,
                        version: documentState.version
                    });

                    // Force a re-render
                    render();
                });
                itemDiv.appendChild(removeButton);

                itemsContainer.appendChild(itemDiv);
            });

            container.appendChild(itemsContainer);
        } else {
            // Regular textarea for notes
            const textarea = document.createElement('textarea');
            textarea.id = `textarea-${tag}`;
            textarea.value = content;

            textarea.addEventListener('input', (e) => {
                // Update local state
                documentState.segments = documentState.segments.map(segment => {
                    if (segment.type === 'section' && segment.tag === tag) {
                        return { ...segment, content: e.target.value };
                    }
                    return segment;
                });
                documentState.version++;

                // Send update to extension
                vscode.postMessage({
                    type: 'updateSection',
                    tag: tag,
                    content: e.target.value,
                    version: documentState.version
                });
            });

            container.appendChild(textarea);
        }

        return container;
    }
}()); 