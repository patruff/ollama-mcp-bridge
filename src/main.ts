import readline from 'readline';
import { MCPLLMBridge } from './bridge';
import { loadBridgeConfig } from './config';
import { logger } from './logger';
import { exec } from 'child_process';
import { BridgeConfig } from './types';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

// TODO: this won't work on macOS
async function forceExit() {
  logger.info('Force exiting...');
  
  try {
    exec('taskkill /F /IM ollama.exe', () => {});
    exec('netstat -ano | findstr ":11434"', (error: any, stdout: string) => {
      if (!error && stdout) {
        const pids = stdout.split('\n')
          .map(line => line.trim().split(/\s+/).pop())
          .filter(pid => pid && /^\d+$/.test(pid));
        
        pids.forEach(pid => {
          exec(`taskkill /F /PID ${pid}`, () => {});
        });
      }
    });
  } catch (e) {
    // Ignore errors during force kill
  }

  setTimeout(() => process.exit(0), 1000);
}

async function main() {
  try {
    logger.info('Starting main.ts...');
    const configFile = await loadBridgeConfig();

    // Create bridge config with all MCPs
    const bridgeConfig: BridgeConfig = {
      mcpServer: configFile.mcpServers.filesystem,  // Primary MCP
      mcpServerName: 'filesystem',
      mcpServers: configFile.mcpServers,           // All MCPs including Flux
      llmConfig: configFile.llm!,
      systemPrompt: configFile.systemPrompt
    };

    logger.info('Initializing bridge with MCPs:', Object.keys(configFile.mcpServers).join(', '));
    const bridge = new MCPLLMBridge(bridgeConfig);
    const initialized = await bridge.initialize();

    if (!initialized) {
      throw new Error('Failed to initialize bridge');
    }

    logger.info('Available commands:');
    logger.info('  list-tools: Show all available tools and their parameters');
    logger.info('  quit: Exit the program');
    logger.info('  Any other input will be sent to the LLM');

    let isClosing = false;

    while (!isClosing) {
      try {
        const userInput = await question("\nEnter your prompt (or 'list-tools' or 'quit'): ");
        
        if (userInput.toLowerCase() === 'quit') {
          isClosing = true;
          await bridge.close();
          rl.close();
          forceExit();
          break;
        }

        if (userInput.toLowerCase() === 'list-tools') {
          await bridge.llmClient.listTools();
          continue;
        }

        logger.info('Processing user input...');
        const response = await bridge.processMessage(userInput);
        logger.info('Received response from bridge');
        console.log(`\nResponse: ${response}`);
      } catch (error: any) {
        logger.error(`Error occurred: ${error?.message || String(error)}`);
      }
    }
  } catch (error: any) {
    logger.error(`Fatal error: ${error?.message || String(error)}`);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  logger.info('Received SIGINT...');
  forceExit();
});

process.on('exit', () => {
  logger.info('Exiting process...');
});

if (require.main === module) {
  main().catch(error => {
    logger.error(`Unhandled error: ${error?.message || String(error)}`);
    forceExit();
  });
}

export { main };