// This script runs inside the sandboxed player.html iframe.
// Its only job is to receive audio data URLs and play them.

let currentAudio = null;

// Listen for messages from the content script
window.addEventListener('message', (event) => {
    const extensionOrigin = chrome.runtime.getURL('');

    // Only handle messages originating from this extension for security.
    if (event.origin !== extensionOrigin) {
        return;
    }

    if (event.data && event.data.action === 'playAudio' && event.data.audioUrl) {
        
        // Stop any audio that might already be playing from a previous request
        if (currentAudio) {
            currentAudio.pause();
        }
        
        // Create a new audio object with the received data URL and play it
        currentAudio = new Audio(event.data.audioUrl);
        currentAudio.play().catch(e => console.error("Kokoro TTS Player Iframe Error:", e));

        // Clean up the audio object after it finishes playing
        currentAudio.addEventListener('ended', () => {
            currentAudio = null;
        }, { once: true });
    }
});
