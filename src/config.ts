import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { logger } from './logger';
import { ServerParameters } from './types';

export interface BridgeConfigFile {
  mcpServers: {
    [key: string]: ServerParameters;
  };
  llm?: {
    model: string;
    baseUrl: string;
    apiKey?: string;
    temperature?: number;
    maxTokens?: number;
  };
  systemPrompt?: string;
}

// TODO: this doesn't work for macOS and needs to be fixed
const DEFAULT_CONFIG: BridgeConfigFile = {
  mcpServers: {
    filesystem: {
      command: process.platform === 'win32' 
        ? 'C:\\Program Files\\nodejs\\node.exe'
        : 'node',
      args: [
        path.join(os.homedir(), 'node_modules', '@modelcontextprotocol', 'server-filesystem', 'dist', 'index.js'),
        path.join(os.homedir(), 'bridgeworkspace')
      ],
      allowedDirectory: path.join(os.homedir(), 'bridgeworkspace')
    }
  },
  llm: {
    model: "qwen2.5-coder:7b-instruct",
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama",
    temperature: 0.7,
    maxTokens: 1000
  },
  systemPrompt: "You are a helpful assistant that can use tools to help answer questions."
};

export async function loadBridgeConfig(): Promise<BridgeConfigFile> {
  // Change to look for config in the project directory
  const projectDir = path.resolve(__dirname, '..');
  const configPath = path.join(projectDir, 'bridge_config.json');
  logger.info(`Looking for bridge configuration at ${configPath}`);

  try {
    const configData = await fs.readFile(configPath, 'utf-8');
    const config = JSON.parse(configData);
    logger.info(`Loaded bridge configuration from ${configPath}`);

    return {
      ...DEFAULT_CONFIG,
      ...config,
      mcpServers: {
        ...DEFAULT_CONFIG.mcpServers,
        ...config.mcpServers
      },
      llm: {
        ...DEFAULT_CONFIG.llm,
        ...config.llm
      }
    };
  } catch (error: any) {
    logger.warn(`Error loading config: ${error.message}`);            // added this so you'll get a specific error if JSON parsing fails
    logger.warn(`Could not load bridge_config.json from ${configPath}, using defaults`);
    return DEFAULT_CONFIG;
  }
}