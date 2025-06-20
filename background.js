// Background script for Kokoro TTS addon
// This script runs continuously in the background to listen for browser events.

// Function to create context menu items
function createContextMenuItems() {
    // Remove existing items first to avoid duplicates
    browser.contextMenus.removeAll().then(() => {
        // Create context menu item for speaking selected text.
        // This item appears when text is selected on a webpage.
        browser.contextMenus.create({
            id: "kokoro-tts-speak",
            title: "Speak selected text with Kokoro",
            contexts: ["selection"] // Show only when text is selected
        });
        
        // Create context menu item for speaking the entire page.
        // This item appears when right-clicking anywhere on the page.
        browser.contextMenus.create({
            id: "kokoro-tts-page",
            title: "Speak entire page with Kokoro",
            contexts: ["page"] // Show on any page
        });
    });
}

// Create context menu items when extension is installed
browser.runtime.onInstalled.addListener(() => {
    createContextMenuItems();
});

// Create context menu items when extension starts up (browser restart)
browser.runtime.onStartup.addListener(() => {
    createContextMenuItems();
});

// Also create them immediately when the script loads
createContextMenuItems();

// Listener for context menu clicks.
// This function is triggered when a user clicks on one of the context menu items created above.
browser.contextMenus.onClicked.addListener(async (info, tab) => {
    console.log("Background Script: Context menu clicked. Menu Item ID:", info.menuItemId);
    
    if (info.menuItemId === "kokoro-tts-speak") {
        console.log("Background Script: Attempting to speak selected text from context menu. Selection:", info.selectionText ? info.selectionText.substring(0, 50) + '...' : '[Empty]');
        // Call speakText and pass the tab ID so we know where to send the audio back
        await speakText(info.selectionText, tab.id); 
    } else if (info.menuItemId === "kokoro-tts-page") {
        console.log("Background Script: Attempting to get entire page text from active tab.");
        const results = await browser.tabs.executeScript(tab.id, {
            code: `
                (function() {
                    const walker = document.createTreeWalker(
                        document.body,
                        NodeFilter.SHOW_TEXT,
                        {
                            acceptNode: function(node) {
                                const parent = node.parentElement;
                                if (parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE')) {
                                    return NodeFilter.FILTER_REJECT;
                                }
                                return NodeFilter.FILTER_ACCEPT;
                            }
                        }
                    );
                    
                    let pageContentText = '';
                    let node;
                    while (node = walker.nextNode()) {
                        const nodeText = node.textContent.trim();
                        if (nodeText) {
                            pageContentText += nodeText + ' ';
                        }
                    }
                    return pageContentText.trim().substring(0, 5000); 
                })();
            `
        });
        
        if (results && results[0]) {
            console.log("Background Script: Captured page text (first 100 chars):", results[0].substring(0, 100) + '...');
            // Call speakText and pass the tab ID for page text as well
            await speakText(results[0], tab.id);
        } else {
            console.warn("Background Script: No readable text found on page for 'Speak entire page'.");
            // Removed system notification: browser.notifications.create for this case
        }
    }
});

/**
 * Sends text to the local TTS server for speech generation.
 * If successful, sends the audio data back to the content script of the specified tab.
 * Displays notifications based on the success or failure of the operation.
 * @param {string} text - The text string to be converted to speech.
 * @param {number} [tabId] - Optional: The ID of the tab to send the audio back to.
 */
async function speakText(text, tabId) {
    console.log("Background Script: speakText function called with text (first 50 chars):", text ? text.substring(0, 50) + '...' : '[Empty/Null]');

    if (!text || !text.trim()) {
        console.warn("Background Script: speakText: Input text is empty or only whitespace. Not sending to server.");
        // Removed system notification: browser.notifications.create for this case
        return;
    }

    try {
        const settings = await browser.storage.local.get({
            voice: 'af_heart',
            speed: 1.0,
            language: 'a'
        });
        
        console.log("Background Script: Sending request to TTS server with settings:", settings);

        // Notify content script that speech generation is starting (for in-page notification)
        if (tabId) {
            try {
                await browser.tabs.sendMessage(tabId, { action: 'showGeneratingSpeech' });
            } catch (notifyError) {
                console.warn("Background Script: Could not send 'showGeneratingSpeech' message to content script:", notifyError);
                // Continue execution even if notification fails, as core functionality is generation
            }
        }

        // Streaming request
        const response = await fetch('http://localhost:8000/stream', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: text.trim(),
                voice: settings.voice,
                speed: settings.speed,
                language: settings.language
            })
        });

        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }

        const reader = response.body.getReader();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // Send audio chunk to content script
            if (tabId) {
                try {
                    await browser.tabs.sendMessage(tabId, {
                        action: 'streamTTSChunk',
                        chunk: value.buffer // Send ArrayBuffer
                    });
                } catch (error) {
                    console.error("Error streaming chunk:", error);
                }
            }
        }
        
        // Signal end of stream
        if (tabId) {
            await browser.tabs.sendMessage(tabId, {
                action: 'streamEnd'
            });
        }
        
    } catch (error) {
        console.error('TTS Streaming Error:', error);
        if (tabId) {
            await browser.tabs.sendMessage(tabId, {
                action: 'streamError',
                error: error.message
            });
        }
    }
}

// Handle messages from other parts of the add-on (e.g., content scripts, popup).
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Background Script: Message received from content script. Action:", request.action);
    if (request.action === 'generateTTS') {
        // When content script requests TTS, call speakText and pass the sender's tab ID.
        // The 'Generating speech...' notification is already shown by content.js before calling this.
        speakText(request.text, sender.tab.id).then(() => {
            sendResponse({success: true});
        }).catch(error => {
            sendResponse({success: false, error: error.message});
        });
        return true; // Indicates that sendResponse will be called asynchronously.
    }
});
