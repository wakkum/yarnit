#!/usr/bin/env bash
# Generates test-audio/sample.wav (15 s, includes "um" and "uh") with macOS text-to-speech.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p test-audio
say -v Samantha -r 170 -o test-audio/sample.aiff "Welcome to the show. Today we are going to, um, talk about editing audio in the browser. The idea is simple. You delete a word from the transcript, and, uh, the audio follows. Nothing leaves your computer. Let's see if the cuts sound clean."
afconvert -f WAVE -d LEI16@44100 test-audio/sample.aiff test-audio/sample.wav
rm test-audio/sample.aiff
echo "Wrote test-audio/sample.wav"
