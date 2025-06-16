#!/usr/bin/env python3
"""
Kokoro TTS Local Server
A local HTTP server that interfaces with the Kokoro TTS model for the Firefox addon.
Enhanced with GPU/CPU detection and thread scaling.
"""

import os
import io
import json
import tempfile
import multiprocessing
from pathlib import Path
from typing import Optional, Dict, Any
import logging

import torch
import soundfile as sf
from flask import Flask, request, jsonify, send_file, Response # Import Response
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
    'af_alloy': 'af_alloy',
    'af_aoede': 'af_aoede',
    'af_bella': 'af_bella',
    'af_jessica': 'af_jessica',
    'af_kore': 'af_kore',
    'af_nicole': 'af_nicole',
    'af_nova': 'af_nova',
    'af_river': 'af_river',
    'af_sarah': 'af_sarah',
    'af_sky': 'af_sky',
    'am_adam': 'am_adam',
    'am_echo': 'am_echo',
    'am_eric': 'am_eric',
    'am_fenrir': 'am_fenrir',
    'am_liam': 'am_liam',
    'am_michael': 'am_michael',
    'am_onyx': 'am_onyx',
    'am_puck': 'am_puck',
    'am_santa': 'am_santa',
    'bf_alice': 'bf_alice',
    'bf_emma': 'bf_emma',
    'bf_isabella': 'bf_isabella',
    'bf_lily': 'bf_lily',
    'bm_daniel': 'bm_daniel',
    'bm_fable': 'bm_fable',
    'bm_george': 'bm_george',
    'bm_lewis': 'bm_lewis'
}

def detect_device():
    """Detect the best available device (GPU/CPU) and configure PyTorch accordingly."""
    device = "cpu"
    device_info = "CPU"
    
    # Check for CUDA (NVIDIA GPUs)
    if torch.cuda.is_available():
        device = "cuda"
        gpu_name = torch.cuda.get_device_name(0)
        gpu_memory = torch.cuda.get_device_properties(0).total_memory / (1024**3)  # GB
        device_info = f"NVIDIA GPU: {gpu_name} ({gpu_memory:.1f}GB VRAM)"
        
        # Enable optimizations for CUDA GPU
        torch.backends.cudnn.benchmark = True
        torch.backends.cudnn.enabled = True
        
        app.logger.info(f"CUDA GPU detected and enabled: {gpu_name}")
        
    # Check for ROCm (AMD GPUs)
    elif torch.cuda.is_available() and torch.version.hip is not None:
        device = "cuda"  # ROCm uses CUDA API compatibility
        try:
            gpu_name = torch.cuda.get_device_name(0)
            gpu_memory = torch.cuda.get_device_properties(0).total_memory / (1024**3)  # GB
            device_info = f"AMD GPU (ROCm): {gpu_name} ({gpu_memory:.1f}GB VRAM)"
            
            # ROCm-specific optimizations
            torch.backends.cudnn.benchmark = True
            torch.backends.cudnn.enabled = True
            
            app.logger.info(f"ROCm AMD GPU detected and enabled: {gpu_name}")
            app.logger.info(f"ROCm version: {torch.version.hip}")
            
        except Exception as e:
            app.logger.warning(f"ROCm GPU detected but couldn't get details: {e}")
            device_info = "AMD GPU (ROCm) - Details unavailable"
        
    # Alternative ROCm detection method (for older PyTorch versions)
    elif hasattr(torch, 'hip') and torch.hip.is_available():
        device = "cuda"  # ROCm uses CUDA-compatible API
        try:
            gpu_count = torch.hip.device_count()
            device_info = f"AMD GPU (ROCm): {gpu_count} device(s) available"
            app.logger.info(f"ROCm AMD GPU detected via torch.hip: {gpu_count} devices")
        except Exception as e:
            device_info = "AMD GPU (ROCm)"
            app.logger.info("ROCm AMD GPU detected")
        
    # Check for Apple Silicon (MPS)
    elif hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
        device = "mps"
        device_info = "Apple Silicon GPU (Metal Performance Shaders)"
        app.logger.info("Apple Silicon GPU detected and enabled")
        
    else:
        # Configure CPU optimizations
        cpu_count = multiprocessing.cpu_count()
        
        # Set optimal thread count for CPU inference
        # Use all cores but leave some headroom for system processes
        optimal_threads = max(1, cpu_count - 1) if cpu_count > 2 else cpu_count
        
        torch.set_num_threads(optimal_threads)
        torch.set_num_interop_threads(optimal_threads)
        
        # Enable CPU optimizations
        if hasattr(torch.backends, 'mkldnn'):
            torch.backends.mkldnn.enabled = True
            
        device_info = f"CPU: {cpu_count} cores (using {optimal_threads} threads)"
        app.logger.info(f"Using CPU with {optimal_threads} threads out of {cpu_count} available cores")
    
    # Set default tensor type based on device
    if device == "cuda":
        torch.set_default_tensor_type('torch.cuda.FloatTensor')
    else:
        torch.set_default_tensor_type('torch.FloatTensor')
    
    return device, device_info

# Initialize device detection
DEVICE, DEVICE_INFO = detect_device()
app.logger.info(f"Initialized with device: {DEVICE_INFO}")

def get_pipeline(lang_code: str) -> KPipeline:
    """Get or create a pipeline for the given language code."""
    try:
        if lang_code not in pipelines:
            app.logger.info(f"Initializing pipeline for language: {lang_code}")
            
            # Create pipeline and move to appropriate device
            pipeline = KPipeline(lang_code=lang_code)
            
            # Move pipeline models to the detected device if GPU is available
            if DEVICE != "cpu" and hasattr(pipeline, 'model'):
                try:
                    if hasattr(pipeline.model, 'to'):
                        pipeline.model.to(DEVICE)
                        app.logger.info(f"Moved pipeline model to {DEVICE}")
                except Exception as e:
                    app.logger.warning(f"Could not move model to {DEVICE}, using CPU: {e}")
            
            pipelines[lang_code] = pipeline
            
        return pipelines[lang_code]
    except Exception as e:
        app.logger.error(f"Error initializing pipeline for language {lang_code}: {e}")
        raise

@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint."""
    try:
        # Attempt to get a pipeline for a default language to check readiness
        get_pipeline('a')
        app.logger.info("Health check successful.")
        
        # Get system information
        cpu_count = multiprocessing.cpu_count()
        memory_info = "N/A"
        
        if DEVICE == "cuda":
            gpu_memory_used = torch.cuda.memory_allocated(0) / (1024**3)  # GB
            gpu_memory_total = torch.cuda.get_device_properties(0).total_memory / (1024**3)  # GB
            memory_info = f"{gpu_memory_used:.1f}GB / {gpu_memory_total:.1f}GB VRAM used"
        
        return jsonify({
            'status': 'healthy',
            'message': 'Kokoro TTS Server is running',
            'device': DEVICE_INFO,
            'memory_info': memory_info,
            'cpu_cores': cpu_count,
            'torch_threads': torch.get_num_threads() if DEVICE == "cpu" else "N/A (GPU mode)",
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
                        f"with voice '{voice}', speed {speed}, language '{language}' on {DEVICE.upper()}")

        # Validate voice against known mapping
        if voice not in VOICE_MAPPING:
            app.logger.warning(f"Invalid voice requested: {voice}. Falling back to default 'af_heart'.")
            voice = 'af_heart'

        # Validate language against known supported languages
        supported_languages = ['a', 'b', 'e', 'f', 'h', 'i', 'j', 'p', 'z']
        if language not in supported_languages:
            app.logger.warning(f"Invalid language requested: {language}. Falling back to default 'a'.")
            language = 'a'

        pipeline = get_pipeline(language)
        app.logger.info(f"Successfully obtained pipeline for language: {language}.")

        # Generate audio segments using the pipeline
        audio_segments = []
        
        # Use torch.no_grad() for inference to save memory
        with torch.no_grad():
            for i, (graphemes, phonemes, audio) in enumerate(pipeline(text, voice=voice, speed=speed, split_pattern=r'\n+')):
                # Move audio to CPU if it's on GPU (for final processing)
                if audio.device.type != 'cpu':
                    audio = audio.cpu()
                
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
        # Using 22050 Hz sample rate as per the original script
        sf.write(output_buffer, full_audio.numpy(), 22050, format='wav')
        output_buffer.seek(0)

        app.logger.info("Speech generation successful. Sending WAV audio file.")
        return send_file(output_buffer, mimetype='audio/wav', as_attachment=False, download_name='speech.wav')

    except Exception as e:
        app.logger.exception(f"An unexpected error occurred during speech generation: {e}")
        return jsonify({'error': f'An internal server error occurred: {e}'}), 500

# Add new streaming endpoint
@app.route('/stream', methods=['POST'])
def stream_speech():
    try:
        data = request.get_json()
        text = data.get('text', '').strip()
        voice = data.get('voice', 'af_heart')
        speed = float(data.get('speed', 1.0))
        language = data.get('language', 'a')

        if not text:
            return jsonify({'error': 'No text provided'}), 400

        pipeline = get_pipeline(language)
        
        # Streaming response
        def generate():
            try:
                with torch.no_grad():
                    # Updated split_pattern to ensure more explicit line break handling and grouped punctuation.
                    # r'[\.?!]+|[;,:]|\n+' will split by:
                    #   - one or more periods, question marks, or exclamation marks (e.g., "...", "!")
                    #   - single commas, semicolons, or colons
                    #   - one or more newlines (e.g., "\n", "\n\n")
                    for i, (_, _, audio) in enumerate(
                        pipeline(text, voice=voice, speed=speed, split_pattern=r'[\.?!]+|[;,:]|\n+') 
                    ):
                        # Convert to raw PCM (16-bit, 22.05kHz, mono)
                        pcm_data = (audio.numpy() * 32767).astype('int16').tobytes()
                        yield pcm_data
            except Exception as e:
                app.logger.error(f"Streaming error: {e}")

        return Response(generate(), mimetype='audio/x-raw')
    
    except Exception as e:
        app.logger.exception(f"Streaming failed: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/system-info', methods=['GET'])
def system_info():
    """Get detailed system information."""
    try:
        info = {
            'device': DEVICE,
            'device_info': DEVICE_INFO,
            'cpu_cores': multiprocessing.cpu_count(),
            'torch_version': torch.__version__,
        }
        
        if DEVICE == "cpu":
            info['torch_threads'] = torch.get_num_threads()
            info['torch_interop_threads'] = torch.get_num_interop_threads()
            info['mkldnn_enabled'] = torch.backends.mkldnn.is_available() if hasattr(torch.backends, 'mkldnn') else False
            
        elif DEVICE == "cuda":
            # Check if this is ROCm or CUDA
            if torch.version.hip is not None:
                # ROCm (AMD GPU)
                info['gpu_backend'] = 'ROCm'
                info['rocm_version'] = torch.version.hip
                info['gpu_count'] = torch.cuda.device_count()
                info['current_gpu'] = torch.cuda.current_device()
                try:
                    info['gpu_memory_allocated'] = f"{torch.cuda.memory_allocated(0) / (1024**3):.2f} GB"
                    info['gpu_memory_total'] = f"{torch.cuda.get_device_properties(0).total_memory / (1024**3):.2f} GB"
                except:
                    info['gpu_memory_info'] = "Memory info unavailable for ROCm device"
            else:
                # NVIDIA CUDA
                info['gpu_backend'] = 'CUDA'
                info['cuda_version'] = torch.version.cuda
                info['gpu_count'] = torch.cuda.device_count()
                info['current_gpu'] = torch.cuda.current_device()
                info['gpu_memory_allocated'] = f"{torch.cuda.memory_allocated(0) / (1024**3):.2f} GB"
                info['gpu_memory_total'] = f"{torch.cuda.get_device_properties(0).total_memory / (1024**3):.2f} GB"
                
        elif DEVICE == "mps":
            info['mps_available'] = torch.backends.mps.is_available()
            
        return jsonify(info), 200
        
    except Exception as e:
        app.logger.error(f"Error getting system info: {e}")
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    # Initialize a default pipeline on server startup for faster first request
    try:
        get_pipeline('a')
        app.logger.info("Default 'a' language pipeline initialized on startup.")
    except Exception as e:
        app.logger.error(f"Failed to initialize default pipeline on startup. Server will still run but TTS for 'a' language might fail on first request: {e}")

    # Run the Flask application
    app.run(host='0.0.0.0', port=8000, debug=False, threaded=True)
