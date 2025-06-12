#!/usr/bin/env python3
"""
Kokoro TTS Local Server
A local HTTP server that interfaces with the Kokoro TTS model for the Firefox addon.
"""

import os
import io
import json
import tempfile
from pathlib import Path
from typing import Optional, Dict, Any
import logging # Import logging

import torch
import soundfile as sf
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from kokoro import KPipeline

# Configure basic logging for better diagnostics
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
app = Flask(__name__)
CORS(app)  # Enable CORS for all domains

# Global pipeline cache
pipelines: Dict[str, KPipeline] = {}

# Voice mapping as provided in your original script
VOICE_MAPPING = {
    'af_heart': 'af_heart',
    'af_sarah': 'af_sarah',
    'af_sky': 'af_sky',
    'am_adam': 'am_adam',
    'am_michael': 'am_michael',
    'bf_emma': 'bf_emma',
    'bf_isabella': 'bf_isabella',
    'bm_george': 'bm_george',
    'bm_lewis': 'bm_lewis'
}

def get_pipeline(lang_code: str) -> KPipeline:
    """Get or create a pipeline for the given language code."""
    try:
        if lang_code not in pipelines:
            app.logger.info(f"Initializing pipeline for language: {lang_code}")
            pipelines[lang_code] = KPipeline(lang_code=lang_code)
        return pipelines[lang_code]
    except Exception as e:
        app.logger.error(f"Error initializing pipeline for language {lang_code}: {e}")
        raise # Re-raise the exception to be caught by the route handler

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    try:
        # Attempt to get a pipeline for a default language to check readiness
        # This will also ensure required models are loaded if not already.
        get_pipeline('a')
        app.logger.info("Health check successful.")
        return jsonify({
            'status': 'healthy',
            'message': 'Kokoro TTS Server is running',
            'available_languages': ['a', 'b', 'e', 'f', 'h', 'i', 'j', 'p', 'z'],
            'available_voices': list(VOICE_MAPPING.keys())
        }), 200
    except Exception as e:
        app.logger.error(f"Health check failed: {e}")
        return jsonify({
            'status': 'unhealthy',
            'message': f'Server is not ready. Please check server logs for details: {e}'
        }), 503

@app.route('/generate', methods=['POST'])
def generate_speech():
    """Generate speech from text."""
    app.logger.info("Received request for speech generation.")
    try:
        data = request.get_json()

        if not data:
            app.logger.warning("No JSON data provided in request.")
            return jsonify({'error': 'No JSON data provided'}), 400

        # Extract parameters with default values
        text = data.get('text', '').strip()
        voice = data.get('voice', 'af_heart')
        speed = float(data.get('speed', 1.0))
        language = data.get('language', 'a')

        if not text:
            app.logger.warning("No text provided for speech generation.")
            return jsonify({'error': 'No text provided for speech generation'}), 400

        app.logger.info(f"Attempting to generate speech for text (first 50 chars): '{text[:50]}...' "
                        f"with voice '{voice}', speed {speed}, language '{language}'.")

        # Validate voice against known mapping
        if voice not in VOICE_MAPPING:
            app.logger.warning(f"Invalid voice requested: {voice}. Falling back to default 'af_heart'.")
            voice = 'af_heart' # Fallback to default if invalid voice is provided

        # Validate language against known supported languages
        supported_languages = ['a', 'b', 'e', 'f', 'h', 'i', 'j', 'p', 'z']
        if language not in supported_languages:
            app.logger.warning(f"Invalid language requested: {language}. Falling back to default 'a'.")
            language = 'a' # Fallback to default if invalid language is provided

        pipeline = get_pipeline(language)
        app.logger.info(f"Successfully obtained pipeline for language: {language}.")

        # Generate audio segments using the pipeline
        audio_segments = []
        for i, (graphemes, phonemes, audio) in enumerate(pipeline(text, voice=voice, speed=speed, split_pattern=r'\n+')):
            audio_segments.append(audio)
            app.logger.debug(f"Generated audio segment {i} for graphemes: {graphemes}")

        if not audio_segments:
            app.logger.error("Speech generation yielded no audio segments. This might indicate an issue with the text or pipeline.")
            return jsonify({'error': 'Failed to generate any audio segments. Check server logs.'}), 500

        # Concatenate all generated audio segments into a single tensor
        if len(audio_segments) > 1:
            full_audio = torch.cat(audio_segments, dim=-1)
            app.logger.info(f"Concatenated {len(audio_segments)} audio segments into one.")
        else:
            full_audio = audio_segments[0]
            app.logger.info("Generated a single audio segment.")

        # Save the combined audio to a BytesIO object in WAV format
        output_buffer = io.BytesIO()
        # Using 24000 Hz sample rate as per the original script
        sf.write(output_buffer, full_audio.numpy(), 24000, format='wav')
        output_buffer.seek(0) # Rewind the buffer to the beginning

        app.logger.info("Speech generation successful. Sending WAV audio file.")
        return send_file(output_buffer, mimetype='audio/wav', as_attachment=False, download_name='speech.wav')

    except Exception as e:
        app.logger.exception(f"An unexpected error occurred during speech generation: {e}")
        return jsonify({'error': f'An internal server error occurred: {e}'}), 500

if __name__ == '__main__':
    # Initialize a default pipeline on server startup for faster first request
    try:
        get_pipeline('a') # Initialize American English pipeline by default
        app.logger.info("Default 'a' language pipeline initialized on startup.")
    except Exception as e:
        app.logger.error(f"Failed to initialize default pipeline on startup. Server will still run but TTS for 'a' language might fail on first request: {e}")

    # Run the Flask application
    # host='0.0.0.0' makes it accessible from your network, not just localhost
    # debug=False is recommended for more stable operation, especially if used by an add-on.
    app.run(host='0.0.0.0', port=8000, debug=False)
