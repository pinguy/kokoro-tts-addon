// Background script for Kokoro TTS addon
// Updated for Chrome extension API

// Function to create context menu items
// Replace browser.* with chrome.*
function createContextMenuItems() {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: "kokoro-tts-speak",
            title: "Speak selected text with Kokoro",
            contexts: ["selection"]
        });

        chrome.contextMenus.create({
            id: "kokoro-tts-page",
            title: "Speak entire page with Kokoro",
            contexts: ["page"]
        });
    });
}

chrome.runtime.onInstalled.addListener(createContextMenuItems);
createContextMenuItems();

// Listener for context menu clicks.
// This function is triggered when a user clicks on one of the context menu items created above.
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    console.log("Background Script: Context menu clicked. Menu Item ID:", info.menuItemId);

    if (info.menuItemId === "kokoro-tts-speak") {
        if (info.selectionText) {
            console.log("Background Script: Attempting to speak selected text from context menu. Selection:", info.selectionText.substring(0, 50) + '...');
            await speakText(info.selectionText, tab.id);
        }
    } else if (info.menuItemId === "kokoro-tts-page") {
        console.log("Background Script: Attempting to get entire page text from active tab.");
        try {
            const results = await chrome.scripting.executeScript({
                target: {tabId: tab.id},
                func: () => {
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
                }
            });

            if (results && results[0] && results[0].result) {
                await speakText(results[0].result, tab.id);
            }
        } catch (error) {
            console.error("Error getting page text:", error);
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
        const settings = await new Promise(resolve =>
            chrome.storage.local.get({
                voice: 'af_heart',
                speed: 1.0,
                language: 'a'
            }, resolve)
        );
        
        console.log("Background Script: Sending request to TTS server with settings:", settings);

        // Notify content script that speech generation is starting (for in-page notification)
        if (tabId) {
            try {
                await chrome.tabs.sendMessage(tabId, { action: 'showGeneratingSpeech' });
            } catch (notifyError) {
                console.warn("Background Script: Could not send 'showGeneratingSpeech' message to content script:", notifyError);
                // Continue execution even if notification fails, as core functionality is generation
            }
        }

        // Non-streaming request
        const response = await fetch('http://localhost:8000/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: text.trim(),
                voice: settings.voice,
                speed: settings.speed,
                language: settings.language
            })
        });

        if (response.ok) {
            const audioBlob = await response.blob();

            const reader = new FileReader();
            reader.readAsDataURL(audioBlob);

            await new Promise((resolve, reject) => {
                reader.onloadend = async () => {
                    const audioDataUrl = reader.result;

                    if (tabId) {
                        try {
                            await chrome.tabs.sendMessage(tabId, {
                                action: 'playTTSAudio',
                                audioUrl: audioDataUrl
                            });
                        } catch (msgError) {
                            console.error("Error sending audio to tab:", msgError);
                        }
                    }
                    resolve();
                };
                reader.onerror = (error) => {
                    reject(error);
                };
            });

        } else {
            const errorText = await response.text();
            throw new Error(`Server error: ${response.status} - ${errorText}`);
        }
        
    } catch (error) {
        console.error('TTS Error:', error);
        if (tabId) {
            await chrome.tabs.sendMessage(tabId, {
                action: 'streamError',
                error: error.message
            });
        }
    }
}

// Handle messages from other parts of the add-on (e.g., content scripts, popup).
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
