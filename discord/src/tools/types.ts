import { Client } from "discord.js";

export interface ToolResponse {
  content: { type: string; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

export interface ToolContext {
  client: Client;
}

export type ToolHandler<T = any> = (args: T, context: ToolContext) => Promise<ToolResponse>; 