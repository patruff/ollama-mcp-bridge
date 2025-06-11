import { describe, it, expect } from '@jest/globals';
import fetch from 'node-fetch';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
const MODEL_NAME = 'phi4-mini-reasoning:latest';
const TEST_TIMEOUT = 300000; // 5 minutes
const HOOK_TIMEOUT = 30000;  // 30 seconds for hooks
const REQUEST_TIMEOUT = 180000; // 3 minutes per request

async function killOllama() {
  try {
    console.log('Killing Ollama processes...');
    await execAsync('taskkill /F /IM ollama.exe').catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log('Ollama processes killed');
  } catch (e) {
    console.log('No Ollama processes found to kill');
  }
}

async function makeOllamaRequest(payload: any) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    console.log('Making request to Ollama with payload:', JSON.stringify(payload, null, 2));
    const startTime = Date.now();
    
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    const endTime = Date.now();
    console.log(`Request took ${endTime - startTime}ms`);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status}, details: ${errorText}`);
    }

    const result = await response.json();
    console.log('Received response:', JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error(`Request timed out after ${REQUEST_TIMEOUT/1000} seconds`);
      }
      throw error;
    }
    throw new Error('Unknown error occurred');
  } finally {
    clearTimeout(timeoutId);
  }
}

describe('Ollama Direct Interaction Tests', () => {
  
  beforeEach(async () => {
    // Kill any existing Ollama processes before each test
    await killOllama();
    // Wait for process to fully terminate
    await new Promise(resolve => setTimeout(resolve, 3000));
  }, HOOK_TIMEOUT);

  it('should successfully connect to Ollama API', async () => {
    // Start Ollama server
    console.log('Starting Ollama server...');
    const ollamaProcess = exec('ollama serve');
    
    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log('Testing connection...');
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    expect(response.ok).toBe(true);
    const result = await response.json();
    console.log('Available models:', JSON.stringify(result, null, 2));
  }, TEST_TIMEOUT);

  it('should test ultra minimal prompt', async () => {
    // Start Ollama server
    console.log('Starting Ollama server...');
    const ollamaProcess = exec('ollama serve');
    
    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 5000));

    const payload = {
      model: MODEL_NAME,
      messages: [
        {
          role: 'system',
          content: 'Format: {"tool_name":"write_file","tool_args":{"path":"NAME","content":"CONTENT"}}'
        },
        {
          role: 'user',
          content: 'create test.txt containing hello'
        }
      ],
      stream: false,
      options: {
        temperature: 0.1,
        num_predict: 100
      }
    };

    const result = await makeOllamaRequest(payload);
    const content = result.message.content.trim()
      .replace(/\`\`\`json\n?/g, '')
      .replace(/\n?\`\`\`/g, '')
      .trim();
    console.log('Response content:', content);

    try {
      const parsed = JSON.parse(content);
      console.log('Parsed response:', parsed);
    } catch (e) {
      console.error('Failed to parse response as JSON');
    }
  }, TEST_TIMEOUT);

  it('should test prompt with format reminder', async () => {
    // Start Ollama server
    console.log('Starting Ollama server...');
    const ollamaProcess = exec('ollama serve');
    
    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 5000));

    const payload = {
      model: MODEL_NAME,
      messages: [
        {
          role: 'system',
          content: 'You must respond with ONLY a JSON object using format {"tool_name":"write_file","tool_args":{"path":"NAME","content":"CONTENT"}} and nothing else.'
        },
        {
          role: 'user',
          content: 'create test.txt containing hello'
        }
      ],
      stream: false,
      options: {
        temperature: 0.1,
        num_predict: 100
      }
    };

    try {
      const result = await makeOllamaRequest(payload);
      const content = result.message.content.trim()
        .replace(/\`\`\`json\n?/g, '')
        .replace(/\n?\`\`\`/g, '')
        .trim();
      console.log('Response content:', content);

      try {
        const parsed = JSON.parse(content);
        console.log('Parsed response:', parsed);
      } catch (e) {
        console.error('Failed to parse response as JSON');
      }
    } catch (error) {
      console.error('Request failed:', error);
    }
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await killOllama();
  }, HOOK_TIMEOUT);
});