import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
const transport = new StdioClientTransport({ command: process.execPath,
  args: [fileURLToPath(new URL('../src/mcp-discord.js', import.meta.url))], stderr: 'pipe' });
const client = new Client({ name: 'discord-schema-check', version: '0.1.0' });
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const note = tools.find(tool => tool.name === 'note_event');
  assert(note);
  assert.equal(note.inputSchema.properties.messages.type, 'array');
  assert.equal(note.inputSchema.properties.messages.maxItems, 10);
  assert(tools.some(tool => tool.name === 'remember_user'));
  console.log('PASS: live stdio MCP handshake exposes note evidence references and memory tools.');
} finally { await client.close(); }
