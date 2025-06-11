import { ChildProcess, exec as childExec } from "child_process";
import { type LLMConfig } from "./types";
import { logger } from "./logger";
import { exec } from "child_process";
import { promisify } from "util";
import { DynamicToolRegistry } from "./tool-registry";
import { toolSchemas } from "./types/tool-schemas";

const execAsync = promisify(childExec);

interface OllamaResponse {
  model: string;
  message: {
    role: string;
    content: string;
  };
}

interface ToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

interface ToolResponse {
  name?: string;
  arguments?: Record<string, unknown>;
  thoughts?: string;
}

export class LLMClient {
  private config: LLMConfig;
  private toolRegistry: DynamicToolRegistry | null = null;
  private currentTool: string | null = null;
  public tools: any[] = [];
  private messages: any[] = [];
  public systemPrompt: string | null = null;
  private readonly toolSchemas: typeof toolSchemas = toolSchemas;
  private static REQUEST_TIMEOUT = 300000; // 5 minutes
  private ollamaProcess: ChildProcess | null = null;

  // Add the format property
  public format: any = null;

  constructor(config: LLMConfig) {
    this.config = config;
    this.systemPrompt = config.systemPrompt || null;
    this.config.baseUrl = this.config.baseUrl.replace("localhost", "127.0.0.1");
    logger.debug(
      `Initializing Ollama client with baseURL: ${this.config.baseUrl}`,
    );
  }

  setToolRegistry(registry: DynamicToolRegistry) {
    this.toolRegistry = registry;
    logger.debug("Tool registry set with tools:", registry.getAllTools());
  }

  public async listTools(): Promise<void> {
    logger.info("===== Available Tools =====");
    if (this.tools.length === 0) {
      logger.info("No tools available");
      return;
    }

    for (const tool of this.tools) {
      logger.info("\nTool Details:");
      logger.info(`Name: ${tool.function.name}`);
      logger.info(`Description: ${tool.function.description}`);
      if (tool.function.parameters) {
        logger.info("Parameters:");
        logger.info(JSON.stringify(tool.function.parameters, null, 2));
      }
      logger.info("------------------------");
    }
    logger.info(`Total tools available: ${this.tools.length}`);
  }

  private async testConnection(): Promise<boolean> {
    try {
      logger.debug("Testing connection to Ollama...");
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        method: "GET",
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        logger.debug("Ollama connection test successful:", data);
        return true;
      } else {
        logger.error(
          "Ollama connection test failed with status:",
          response.status,
        );
        return false;
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === "AbortError") {
          logger.error("Ollama connection test timed out after 5 seconds");
        } else {
          logger.error(
            "Ollama connection test failed with error:",
            error.message,
          );
        }
      }
      return false;
    }
  }

  private async forceKillOllama(): Promise<void> {
    try {
      logger.debug("Starting Ollama cleanup process...");

      try {
        logger.debug("Attempting to kill Ollama by process name...");
        const { stdout: killOutput } = await execAsync(
          "taskkill /F /IM ollama.exe",
        );
        logger.debug("Taskkill output:", killOutput);
      } catch (e) {
        logger.debug("No Ollama process found to kill");
      }

      try {
        logger.debug("Checking for processes on port 11434...");
        const { stdout } = await execAsync('netstat -ano | findstr ":11434"');
        const pids = stdout
          .split("\n")
          .map((line) => line.trim().split(/\s+/).pop())
          .filter((pid) => pid && /^\d+$/.test(pid));

        for (const pid of pids) {
          logger.debug(`Killing process with PID ${pid}...`);
          await execAsync(`taskkill /F /PID ${pid}`);
        }
      } catch (e) {
        logger.debug("No processes found on port 11434");
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
      logger.debug("Ollama cleanup process completed");
    } catch (error) {
      logger.error("Error during Ollama force kill:", error);
    }
  }

  private prepareMessages(): any[] {
    const formattedMessages = [];
    if (this.systemPrompt) {
      formattedMessages.push({
        role: "system",
        content: this.systemPrompt,
      });
    }

    formattedMessages.push(...this.messages);
    return formattedMessages;
  }

  async invokeWithPrompt(prompt: string) {
    if (!this.ollamaProcess) {
      logger.debug("Starting new Ollama instance...");
      this.ollamaProcess = exec("ollama serve", { windowsHide: true });

      this.ollamaProcess.stdout?.on("data", (data) => {
        logger.debug("Ollama stdout:", data.toString());
      });

      this.ollamaProcess.stderr?.on("data", (data) => {
        logger.debug("Ollama stderr:", data.toString());
      });

      this.ollamaProcess.on("error", (error) => {
        logger.error("Error starting Ollama:", error);
      });

      this.ollamaProcess.unref();

      let connected = false;
      for (let i = 0; i < 10; i++) {
        logger.debug(`Waiting for Ollama to start (attempt ${i + 1}/10)...`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (await this.testConnection()) {
          logger.debug("Ollama is ready and responding");
          connected = true;
          break;
        }
      }

      if (!connected) {
        throw new Error("Failed to start Ollama after 10 attempts");
      }
    } else {
      logger.debug("Reusing existing Ollama instance...");
    }

    // Detect tool using registry if available
    if (this.toolRegistry) {
      this.currentTool = this.toolRegistry.detectToolFromPrompt(prompt);
      logger.debug(`Detected tool from registry: ${this.currentTool}`);
    }

    logger.debug(`Preparing to send prompt: ${prompt}`);
    this.messages = [];
    this.messages.push({
      role: "user",
      content: prompt,
    });

    return this.invoke([]);
  }

  async invoke(toolResults: any[] = []) {
    try {
      if (toolResults.length > 0) {
        for (const result of toolResults) {
          const toolOutput = result.output;
          try {
            const parsedOutput = JSON.parse(toolOutput);
            if (parsedOutput.content && Array.isArray(parsedOutput.content)) {
              // Extract text content from MCP response
              const content = parsedOutput.content
                .filter((item: any) => item.type === "text")
                .map((item: any) => item.text)
                .join("\n");
              this.messages.push({
                role: "tool",
                content,
                tool_call_id: result.tool_call_id,
              });
            } else {
              this.messages.push({
                role: "tool",
                content: String(toolOutput),
                tool_call_id: result.tool_call_id,
              });
            }
          } catch (e) {
            // If not JSON, use as-is
            this.messages.push({
              role: "tool",
              content: String(toolOutput),
              tool_call_id: result.tool_call_id,
            });
          }
        }
      }

      const messages = this.prepareMessages();
      const payload: any = {
        model: this.config.model,
        messages: [], // Start with an empty array for structured messages
        stream: false,
        options: {
          temperature: this.config.temperature || 0,
          num_predict: this.config.maxTokens || 1000,
        },
      };

      // Add the messages
      for (const message of messages) {
        if (message.role === "tool") {
          payload.messages.push({
            role: message.role,
            content: message.content,
            tool_call_id: message.tool_call_id,
          });
        } else {
          payload.messages.push({
            role: message.role,
            content: message.content,
          });
        }
      }

      // Add structured output format if a tool is detected OR if format is explicitly set
      if (this.format) {
        // Use explicitly set format
        payload.format = "json";
        payload.options = payload.options || {};
      } else if (this.currentTool) {
        const toolSchema = this.currentTool
          ? this.toolSchemas[this.currentTool as keyof typeof toolSchemas]
          : null;
        if (toolSchema) {
          // Convert the JSON schema to a string
          payload.format = "json";
          // Add the schema as a separate property
          payload.options = payload.options || {};
        }
      }

      logger.debug(
        "Preparing Ollama request with payload:",
        JSON.stringify(payload, null, 2),
      );

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
        logger.error(
          `Request timed out after ${LLMClient.REQUEST_TIMEOUT / 1000} seconds`,
        );
      }, LLMClient.REQUEST_TIMEOUT);

      logger.debug("Sending request to Ollama...");
      const response = await fetch(`${this.config.baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        logger.error("Ollama request failed:", {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
        });
        throw new Error(
          `HTTP error! status: ${response.status}, details: ${errorText}`,
        );
      }

      logger.debug("Response received from Ollama, parsing...");
      const completion = (await response.json()) as OllamaResponse;
      logger.debug("Parsed response:", completion);

      let isToolCall = false;
      let toolCalls: ToolCall[] = [];
      let content: any = completion.message.content;

      // Parse the structured response
      try {
        if (typeof content === "string" && content.startsWith("```json")) {
          content = content
            .replace(/^```json/, "")
            .replace(/```$/, "")
            .trim();
          logger.debug("Cleaned Markdown response:", content);
        }
        const contentObj =
          typeof content === "string" ? JSON.parse(content) : content;

        if (contentObj.name && contentObj.arguments) {
          isToolCall = true;
          toolCalls = [
            {
              id: `call-${Date.now()}`,
              function: {
                name: contentObj.name,
                arguments: JSON.stringify(contentObj.arguments),
              },
            },
          ];
          content = contentObj.thoughts || "Using tool...";
          logger.debug("Parsed structured tool call:", { toolCalls });
        }
      } catch (e) {
        logger.debug("Response is not a structured tool call:", e);
      }

      const result = {
        content:
          typeof content === "string" ? content : JSON.stringify(content),
        isToolCall,
        toolCalls,
      };

      if (result.isToolCall) {
        this.messages.push({
          role: "assistant",
          content: result.content,
          tool_calls: result.toolCalls?.map((call) => ({
            id: call.id,
            type: "function",
            function: {
              name: call.function.name,
              arguments: call.function.arguments,
            },
          })),
        });
      } else {
        this.messages.push({
          role: "assistant",
          content: result.content,
        });
      }

      return result;
    } catch (error: any) {
      if (error.name === "AbortError") {
        logger.error("Request aborted due to timeout");
        throw new Error(
          `Request timed out after ${LLMClient.REQUEST_TIMEOUT / 1000} seconds`,
        );
      }
      logger.error("LLM invocation failed:", error);
      throw error;
    } finally {
      logger.debug("Cleaning up Ollama process...");
      await this.forceKillOllama();
    }
  }
}
