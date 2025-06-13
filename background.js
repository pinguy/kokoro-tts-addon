// Background script for Kokoro TTS addon
// This script runs continuously in the background to listen for browser events.

browser.runtime.onInstalled.addListener(() => {
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
            browser.notifications.create({
                type: 'basic',
                iconUrl: '',
                title: 'Kokoro TTS Warning',
                message: 'No readable text found on this page.'
            });
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
        browser.notifications.create({
            type: 'basic',
            iconUrl: '',
            title: 'Kokoro TTS Warning',
            message: 'No text selected to speak.'
        });
        return;
    }

    try {
        const settings = await browser.storage.local.get({
            voice: 'af_heart',
            speed: 1.0,
            language: 'a'
        });
        
        console.log("Background Script: Sending request to TTS server with settings:", settings);

        const response = await fetch('http://localhost:8000/generate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                text: text.trim(),
                voice: settings.voice,
                speed: settings.speed,
                language: settings.language
            })
        });
        
        if (response.ok) {
            console.log("Background Script: Server responded successfully (status 200 OK). Attempting to get audio blob.");
            const audioBlob = await response.blob(); // Get the audio as a Blob
            
            // Convert Blob to Base64 data URL for sending via message
            const reader = new FileReader();
            reader.readAsDataURL(audioBlob); // Reads the blob as a data URL (base64)

            // Return a Promise that resolves when the file is read
            await new Promise((resolve, reject) => {
                reader.onloadend = async () => {
                    const audioDataUrl = reader.result; // This is the base64 data URL
                    console.log("Background Script: Audio blob converted to data URL. Sending to content script.");
                    
                    if (tabId) {
                        try {
                            // Send the data URL to the content script of the specified tab
                            await browser.tabs.sendMessage(tabId, {
                                action: 'playTTSAudio',
                                audioUrl: audioDataUrl
                            });
                            browser.notifications.create({
                                type: 'basic',
                                iconUrl: '',
                                title: 'Kokoro TTS',
                                message: 'Speech generated and playing!'
                            });
                            console.log("Background Script: Message to content script sent successfully.");
                        } catch (msgError) {
                            console.error("Background Script: Error sending message to content script:", msgError);
                            browser.notifications.create({
                                type: 'basic',
                                iconUrl: '',
                                title: 'Kokoro TTS Error',
                                message: 'Speech generated but failed to play in tab. See console for details.'
                            });
                        }
                    } else {
                         // Fallback notification if no tabId (e.g. if invoked from popup, but popup handles its own playback)
                         browser.notifications.create({
                            type: 'basic',
                            iconUrl: '',
                            title: 'Kokoro TTS',
                            message: 'Speech generated successfully!'
                         });
                    }
                    resolve(); // Resolve the promise once message is sent or error handled
                };
                reader.onerror = (error) => {
                    console.error("Background Script: FileReader error:", error);
                    reject(error);
                };
            });
            
        } else {
            const errorText = await response.text();
            console.error("Background Script: Server error response:", response.status, errorText);
            throw new Error(`Server error: ${response.status} - ${errorText}`);
        }
        
    } catch (error) {
        console.error('Background Script: TTS Error (in speakText function):', error);
        browser.notifications.create({
            type: 'basic',
            iconUrl: '',
            title: 'Kokoro TTS Error',
            message: `Failed to generate speech. Make sure the local server is running. Error: ${error.message}`
        });
    }
}

// Handle messages from other parts of the add-on (e.g., content scripts, popup).
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Background Script: Message received from content script. Action:", request.action);
    if (request.action === 'generateTTS') {
        // When content script requests TTS, call speakText and pass the sender's tab ID.
        speakText(request.text, sender.tab.id).then(() => {
            sendResponse({success: true});
        }).catch(error => {
            sendResponse({success: false, error: error.message});
        });
        return true; // Indicates that sendResponse will be called asynchronously.
    }
});
